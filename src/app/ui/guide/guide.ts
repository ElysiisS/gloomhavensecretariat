import { NgClass } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, inject, OnDestroy, OnInit } from '@angular/core';
import { GameManager, gameManager } from 'src/app/game/businesslogic/GameManager';
import { GhsManager } from 'src/app/game/businesslogic/GhsManager';
import { SettingsManager, settingsManager } from 'src/app/game/businesslogic/SettingsManager';
import { Character } from 'src/app/game/model/Character';
import { Action, ActionType, ActionValueType } from 'src/app/game/model/data/Action';
import { ConditionName, EntityCondition } from 'src/app/game/model/data/Condition';
import { ElementState } from 'src/app/game/model/data/Element';
import { MonsterType } from 'src/app/game/model/data/MonsterType';
import { EntityValueFunction } from 'src/app/game/model/Entity';
import { Figure } from 'src/app/game/model/Figure';
import { GameState } from 'src/app/game/model/Game';
import { Monster } from 'src/app/game/model/Monster';
import { MonsterEntity } from 'src/app/game/model/MonsterEntity';
import { GhsLabelDirective } from 'src/app/ui/helper/label';

export type GuidePhase = 'setup' | 'cardSelection' | 'turns' | 'roundEnd' | 'scenarioEnd';

// a single instruction of the guide, optionally pointing at an element of the interface
export type GuideStep = { label: string; args?: (string | number)[]; target?: () => Element | null; warning?: boolean };

export type GuideRect = { top: number; left: number; width: number; height: number };

export const GuidePhases: GuidePhase[] = ['cardSelection', 'turns', 'roundEnd'];

export const GuideTopics: string[] = [
  'basics',
  'cards',
  'turn',
  'move',
  'attack',
  'modifiers',
  'conditions',
  'elements',
  'monsters',
  'summons',
  'rest',
  'exhaustion',
  'loot',
  'scenarioEnd'
];

// conditions of the 1st edition explained by the guide
export const GuideConditions: ConditionName[] = [
  ConditionName.poison,
  ConditionName.wound,
  ConditionName.immobilize,
  ConditionName.disarm,
  ConditionName.stun,
  ConditionName.muddle,
  ConditionName.curse,
  ConditionName.invisible,
  ConditionName.strengthen,
  ConditionName.bless
];

const visible = (selector: string, parent: ParentNode | null = document): Element | null => {
  if (!parent) {
    return null;
  }
  return Array.from(parent.querySelectorAll(selector)).find((element) => element.getClientRects().length > 0) || null;
};

const figureElement = (figure: Figure): Element | null => {
  return document.querySelector('[data-guide-figure="' + figure.edition + '-' + figure.name + '"]');
};

@Component({
  imports: [NgClass, GhsLabelDirective],
  selector: 'ghs-guide',
  templateUrl: './guide.html',
  styleUrls: ['./guide.scss']
})
export class GuideComponent implements OnInit, OnDestroy {
  private ghsManager = inject(GhsManager);
  private cdr = inject(ChangeDetectorRef);
  private elementRef = inject(ElementRef);

  gameManager: GameManager = gameManager;
  settingsManager: SettingsManager = settingsManager;
  GuidePhases = GuidePhases;
  GuideTopics = GuideTopics;
  GuideConditions = GuideConditions;

  phase: GuidePhase = 'setup';
  steps: GuideStep[] = [];
  stepIndex: number = 0;
  context: string = '';

  highlight: GuideRect | undefined;
  bubbleTop: number | undefined;
  bubbleLeft: number | undefined;
  scrolledTarget: Element | undefined;

  reference: boolean = false;
  tab: 'round' | 'rules' = 'round';
  openPhase: GuidePhase | undefined;
  openTopic: string | undefined;

  private interval: any;

  constructor() {
    this.ghsManager.uiChangeEffect(() => this.update());
  }

  ngOnInit(): void {
    this.interval = setInterval(() => this.position(), 250);
  }

  ngOnDestroy(): void {
    clearInterval(this.interval);
  }

  get step(): GuideStep | undefined {
    return this.steps[this.stepIndex];
  }

  update() {
    const game = gameManager.game;
    const characters = game.figures.filter((figure) => figure instanceof Character) as Character[];
    const monsters = game.figures.filter((figure) => figure instanceof Monster) as Monster[];
    const active = game.state === GameState.next ? game.figures.find((figure) => figure.active && !figure.off) : undefined;
    const steps: GuideStep[] = [];

    if (game.finish) {
      this.phase = 'scenarioEnd';
      steps.push({ label: 'guide.step.scenarioEnd', args: [gameManager.levelManager.loot(), gameManager.levelManager.experience()] });
    } else if (characters.length === 0) {
      this.phase = 'setup';
      steps.push({ label: 'guide.step.addCharacters', target: () => visible('.add-characters') || visible('ghs-header .menu-button') });
    } else if (
      game.scenario &&
      characters.every((character) => character.exhausted || character.absent || !gameManager.entityManager.isAlive(character))
    ) {
      this.phase = 'scenarioEnd';
      steps.push({ label: 'guide.step.allExhausted', warning: true });
    } else if (game.state === GameState.draw) {
      this.phase = 'cardSelection';
      if (!game.scenario && monsters.length === 0) {
        steps.push({ label: 'guide.step.chooseScenario', target: () => visible('ghs-header .menu-button') });
      }
      if (game.round === 0) {
        steps.push({ label: 'guide.step.firstRound' });
      }
      steps.push({ label: 'guide.step.chooseCards' });
      characters
        .filter(
          (character) =>
            gameManager.entityManager.isAlive(character) && !character.absent && !character.exhausted && character.getInitiative() <= 0
        )
        .forEach((character) =>
          steps.push({
            label: 'guide.step.initiative',
            args: [gameManager.characterManager.characterName(character)],
            target: () => visible('.drag-initiative', figureElement(character)) || figureElement(character)
          })
        );
      steps.push({ label: 'guide.step.draw', target: () => visible('ghs-footer .round-container') });
    } else if (active instanceof Character) {
      this.phase = 'turns';
      const name = gameManager.characterManager.characterName(active);
      steps.push({ label: 'guide.step.characterTurn', args: [name, active.initiative], target: () => figureElement(active) });
      if (active.summons.some((summon) => gameManager.entityManager.isAlive(summon))) {
        steps.push({ label: 'guide.step.summons', target: () => visible('.summons-container', figureElement(active)) });
      }
      const characterDeck = () =>
        visible('.attack-modifier-button', figureElement(active)) ||
        visible('ghs-attackmodifier-deck', figureElement(active)) ||
        visible('ghs-footer .character-deck');
      if (active.longRest) {
        steps.push({
          label: settingsManager.settings.applyLongRest ? 'guide.step.longRestAuto' : 'guide.step.longRest',
          args: [name],
          target: () => figureElement(active)
        });
        this.conditionSteps(active.entityConditions, steps, () => figureElement(active));
      } else {
        this.conditionSteps(active.entityConditions, steps, () => figureElement(active), characterDeck);
        steps.push({ label: 'guide.step.playCards' });
        steps.push({ label: 'guide.step.move', args: [gameManager.levelManager.trap(), gameManager.levelManager.terrain()] });
        if (visible('ghs-footer .room')) {
          steps.push({ label: 'guide.step.openDoor', target: () => visible('ghs-footer .room') });
        }
        steps.push({ label: 'guide.step.characterAttack', target: characterDeck });
        const targets = this.targetNotes(monsters, active);
        if (targets.length > 0) {
          steps.push({ label: 'guide.step.list', args: [targets.join('<br>')], target: () => visible('ghs-standee'), warning: true });
        }
        if (monsters.some((monster) => monster.entities.some((entity) => gameManager.entityManager.isAlive(entity)))) {
          steps.push({ label: 'guide.step.damageMonster', target: () => visible('ghs-standee') });
        }
        steps.push({ label: 'guide.step.elementsInfuse', target: () => visible('ghs-header .elements') });
      }
      steps.push({
        label: 'guide.step.endCharacterTurn',
        args: [name],
        target: () => visible('.drag-initiative', figureElement(active)) || figureElement(active)
      });
    } else if (active instanceof Monster) {
      this.phase = 'turns';
      const name = settingsManager.getLabel('data.monster.' + active.name);
      const abilityTarget = () => visible('ghs-monster-ability-card', figureElement(active)) || figureElement(active);
      const entitiesTarget = () => visible('.entities', figureElement(active));
      const monsterDeck = () => visible('ghs-footer .monster-deck');
      const abilityCard = gameManager.monsterManager.getAbilityCard(active);
      const actions = abilityCard ? this.flatActions(abilityCard.actions) : [];
      const attacks = actions.some((action) => action.type === ActionType.attack);
      steps.push({ label: 'guide.step.monsterTurn', args: [name], target: abilityTarget });
      if (abilityCard && !attacks && actions.some((action) => action.type === ActionType.move)) {
        steps.push({ label: 'guide.step.monsterNoAttack', target: abilityTarget });
      }
      if (actions.some((action) => action.type === ActionType.heal)) {
        steps.push({ label: 'guide.step.monsterHeal', target: abilityTarget });
      }
      if (actions.some((action) => action.type === ActionType.summon || action.type === ActionType.spawn)) {
        steps.push({ label: 'guide.step.monsterSummon', target: abilityTarget });
      }
      actions
        .filter((action) => action.type === ActionType.element && action.valueType === ActionValueType.minus)
        .forEach((action) => {
          const elements = ('' + action.value).split(':');
          const available = elements.every((type) =>
            game.elementBoard.some(
              (element) =>
                (element.type === type || type === 'wild') &&
                (element.state === ElementState.strong || element.state === ElementState.waning)
            )
          );
          if (available) {
            steps.push({
              label: 'guide.step.monsterConsume',
              args: [elements.map((type) => '%game.element.' + type + '%').join(' ')],
              target: () => visible('ghs-header .elements')
            });
          }
        });
      steps.push({ label: 'guide.step.monsterOrder', target: entitiesTarget });
      const standees = this.standeeNotes(active);
      if (standees.length > 0) {
        steps.push({ label: 'guide.step.list', args: [standees.join('<br>')], target: entitiesTarget, warning: true });
      }
      steps.push({ label: 'guide.step.monsterFocus', target: entitiesTarget });
      const focus = this.focusNotes(characters);
      if (focus.length > 0) {
        steps.push({ label: 'guide.step.list', args: [focus.join('<br>')], target: () => visible('ghs-character'), warning: true });
      }
      if (attacks && this.ranged(active)) {
        steps.push({ label: 'guide.step.monsterRanged', target: entitiesTarget });
      }
      const conditions: EntityCondition[] = [];
      active.entities
        .filter((entity) => gameManager.entityManager.isAlive(entity))
        .forEach((entity) => conditions.push(...entity.entityConditions));
      this.deckConditionSteps(conditions, steps, monsterDeck);
      if (attacks || !abilityCard) {
        steps.push({ label: 'guide.step.monsterAttack', target: monsterDeck });
        const poisoned = characters.filter(
          (character) =>
            gameManager.entityManager.isAlive(character) &&
            character.entityConditions.some((condition) => condition.name === ConditionName.poison && !condition.expired)
        );
        if (poisoned.length > 0) {
          steps.push({
            label: 'guide.step.poisonedCharacters',
            args: [poisoned.map((character) => gameManager.characterManager.characterName(character)).join(', ')],
            target: () => figureElement(poisoned[0]),
            warning: true
          });
        }
        steps.push({ label: 'guide.step.damageCharacter', target: () => visible('ghs-character') });
      }
      if (abilityCard && abilityCard.shuffle) {
        steps.push({ label: 'guide.step.monsterShuffle', target: abilityTarget });
      }
      steps.push({
        label: 'guide.step.endMonsterTurn',
        args: [name],
        target: () => visible('ghs-monster-image', figureElement(active)) || figureElement(active)
      });
    } else if (active) {
      this.phase = 'turns';
      steps.push({ label: 'guide.step.otherTurn', target: () => figureElement(active) });
    } else {
      this.phase = 'roundEnd';
      steps.push({ label: 'guide.step.roundEnd' });
      if (game.scenario && monsters.every((monster) => this.aliveEntities(monster).length === 0)) {
        steps.push({ label: 'guide.step.objective', target: () => visible('ghs-footer .round-container') });
      }
      if (game.elementBoard.some((element) => element.state === ElementState.strong || element.state === ElementState.waning)) {
        steps.push({ label: 'guide.step.elementsWane', target: () => visible('ghs-header .elements') });
      }
      if (this.deckShuffle(game.monsterAttackModifierDeck.cards, game.monsterAttackModifierDeck.current)) {
        steps.push({ label: 'guide.step.monsterModifierShuffle', target: () => visible('ghs-footer .monster-deck') });
      }
      characters
        .filter((character) => this.deckShuffle(character.attackModifierDeck.cards, character.attackModifierDeck.current))
        .forEach((character) =>
          steps.push({
            label: 'guide.step.characterModifierShuffle',
            args: [gameManager.characterManager.characterName(character)],
            target: () => figureElement(character)
          })
        );
      steps.push({ label: 'guide.step.shortRest' });
      steps.push({ label: 'guide.step.nextRound', target: () => visible('ghs-footer .round-container') });
    }

    // restart at the first step whenever the situation changes (new phase, new active figure)
    const context = this.phase + '|' + game.round + '|' + (active ? active.edition + '-' + active.name : '');
    if (context !== this.context) {
      this.context = context;
      this.stepIndex = 0;
    }
    this.steps = steps;
    this.stepIndex = Math.max(0, Math.min(this.stepIndex, steps.length - 1));
    this.position();
  }

  conditionSteps(
    entityConditions: EntityCondition[],
    steps: GuideStep[],
    target: () => Element | null,
    deckTarget: (() => Element | null) | undefined = undefined
  ) {
    const names: ConditionName[] = [];
    entityConditions
      .filter((condition) => !condition.expired && GuideConditions.includes(condition.name))
      .forEach((condition) => {
        if (!names.includes(condition.name)) {
          names.push(condition.name);
        }
      });
    const automatic = settingsManager.settings.amAdvantage && settingsManager.settings.amAdvantageConditions;
    names.forEach((name) => {
      if (deckTarget && (name === ConditionName.strengthen || name === ConditionName.muddle)) {
        steps.push({ label: 'guide.step.draw' + (automatic ? 'Auto.' : 'Manual.') + name, target: deckTarget, warning: true });
      } else {
        steps.push({ label: 'guide.condition.' + name, target: target, warning: true });
      }
    });
  }

  // strengthen/muddle shared by every standee of the group make the monster deck draw two cards
  deckConditionSteps(entityConditions: EntityCondition[], steps: GuideStep[], deckTarget: () => Element | null) {
    const automatic = settingsManager.settings.amAdvantage && settingsManager.settings.amAdvantageConditions;
    const entities = gameManager.game.figures
      .filter((figure) => figure instanceof Monster && figure.active)
      .flatMap((figure) => (figure as Monster).entities.filter((entity) => gameManager.entityManager.isAlive(entity)));
    [ConditionName.strengthen, ConditionName.muddle]
      .filter(
        (name) =>
          entityConditions.some((condition) => condition.name === name && !condition.expired) &&
          entities.every((entity) => entity.entityConditions.some((condition) => condition.name === name && !condition.expired))
      )
      .forEach((name) =>
        steps.push({ label: 'guide.step.draw' + (automatic ? 'Auto.' : 'Manual.') + name, target: deckTarget, warning: true })
      );
  }

  flatActions(actions: Action[] | undefined): Action[] {
    const result: Action[] = [];
    (actions || []).forEach((action) => {
      result.push(action);
      result.push(...this.flatActions(action.subActions));
    });
    return result;
  }

  standeeName(monster: Monster, entity: MonsterEntity): string {
    // standees without an assigned number have a negative one
    return settingsManager.getLabel('guide.monsterType.' + entity.type) + (entity.number > 0 ? ' ' + entity.number : '');
  }

  aliveEntities(monster: Monster): MonsterEntity[] {
    const order = [MonsterType.boss, MonsterType.elite, MonsterType.normal];
    return monster.entities
      .filter((entity) => gameManager.entityManager.isAlive(entity))
      .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.number - b.number);
  }

  hasCondition(entity: { entityConditions: EntityCondition[] }, name: ConditionName): boolean {
    return entity.entityConditions.some((condition) => condition.name === name && !condition.expired);
  }

  // what each standee of the acting monster can or cannot do this turn because of its conditions
  standeeNotes(monster: Monster): string[] {
    const notes: string[] = [];
    const entities = this.aliveEntities(monster);
    entities.forEach((entity) => {
      const standee = this.standeeName(monster, entity);
      if (this.hasCondition(entity, ConditionName.stun)) {
        notes.push(settingsManager.getLabel('guide.standee.stun', [standee]));
        return;
      }
      if (this.hasCondition(entity, ConditionName.wound)) {
        notes.push(
          settingsManager.getLabel(settingsManager.settings.applyConditions ? 'guide.standee.woundAuto' : 'guide.standee.wound', [standee])
        );
      }
      [ConditionName.immobilize, ConditionName.disarm].forEach((name) => {
        if (this.hasCondition(entity, name)) {
          notes.push(settingsManager.getLabel('guide.standee.' + name, [standee]));
        }
      });
      // a condition only some standees have needs the manual advantage/disadvantage buttons
      [ConditionName.strengthen, ConditionName.muddle].forEach((name) => {
        if (this.hasCondition(entity, name) && !entities.every((other) => this.hasCondition(other, name))) {
          notes.push(settingsManager.getLabel('guide.standee.' + name, [standee]));
        }
      });
    });
    return notes;
  }

  // monster focus rules that depend on the characters
  focusNotes(characters: Character[]): string[] {
    const notes: string[] = [];
    const alive = characters.filter(
      (character) => gameManager.entityManager.isAlive(character) && !character.exhausted && !character.absent
    );
    alive
      .filter((character) => this.hasCondition(character, ConditionName.invisible))
      .forEach((character) =>
        notes.push(settingsManager.getLabel('guide.focus.invisible', [gameManager.characterManager.characterName(character)]))
      );
    alive
      .filter((character) => character.longRest)
      .forEach((character) =>
        notes.push(settingsManager.getLabel('guide.focus.longRest', [gameManager.characterManager.characterName(character)]))
      );
    if (alive.some((character) => character.summons.some((summon) => gameManager.entityManager.isAlive(summon)))) {
      notes.push(settingsManager.getLabel('guide.focus.summons'));
    }
    return notes;
  }

  ranged(monster: Monster): boolean {
    return this.aliveEntities(monster).some(
      (entity) => EntityValueFunction(gameManager.monsterManager.getStat(monster, entity.type).range) > 0
    );
  }

  // shield, retaliate and poison of the enemies the character may attack
  targetNotes(monsters: Monster[], active: Character): string[] {
    const notes: string[] = [];
    const figures = gameManager.game.figures;
    monsters
      .filter((monster) => !monster.isAlly && !monster.isAllied)
      .forEach((monster) => {
        const entities = this.aliveEntities(monster);
        if (entities.length === 0) {
          return;
        }
        const name = settingsManager.getLabel('data.monster.' + monster.name);
        // bonuses of the ability card only count once the monster has acted this round
        const acted = figures.indexOf(monster) < figures.indexOf(active);
        const abilityCard = acted ? gameManager.monsterManager.getAbilityCard(monster) : undefined;
        const types = entities.map((entity) => entity.type).filter((type, index, self) => self.indexOf(type) === index);
        types.forEach((type) => {
          const stat = gameManager.monsterManager.getStat(monster, type);
          const bonus = [...(stat.actions || []), ...(abilityCard ? abilityCard.actions : [])];
          const sum = (actionType: ActionType) =>
            bonus.filter((action) => action.type === actionType).reduce((total, action) => total + EntityValueFunction(action.value), 0);
          const shield = sum(ActionType.shield);
          const retaliate = sum(ActionType.retaliate);
          const label = name + (types.length > 1 ? ' (' + settingsManager.getLabel('guide.monsterType.' + type) + ')' : '');
          if (shield > 0) {
            notes.push(settingsManager.getLabel('guide.target.shield', [label, '' + shield]));
          }
          if (retaliate > 0) {
            notes.push(settingsManager.getLabel('guide.target.retaliate', [label, '' + retaliate]));
          }
        });
        const poisoned = entities.filter((entity) => this.hasCondition(entity, ConditionName.poison));
        if (poisoned.length > 0) {
          notes.push(
            settingsManager.getLabel('guide.target.poison', [name, poisoned.map((entity) => this.standeeName(monster, entity)).join(', ')])
          );
        }
      });
    return notes;
  }

  deckShuffle(cards: { shuffle: boolean }[], current: number): boolean {
    return cards.slice(0, current + 1).some((card) => card && card.shuffle);
  }

  // keep the highlight and the bubble next to the target, which may move (scrolling, animations, dialogs)
  position() {
    const target = this.step && this.step.target && !settingsManager.settings.guideModeMinimized ? this.step.target() : null;
    let highlight: GuideRect | undefined;
    let bubbleTop: number | undefined;
    let bubbleLeft: number | undefined;

    if (target) {
      if (this.scrolledTarget !== target) {
        this.scrolledTarget = target;
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      const rect = target.getBoundingClientRect();
      const padding = 4;
      highlight = {
        top: Math.round(rect.top - padding),
        left: Math.round(rect.left - padding),
        width: Math.round(rect.width + padding * 2),
        height: Math.round(rect.height + padding * 2)
      };
      const bubble: HTMLElement | null = this.elementRef.nativeElement.querySelector('.guide-bubble');
      const bubbleWidth = bubble ? bubble.offsetWidth : 300;
      const bubbleHeight = bubble ? bubble.offsetHeight : 150;
      const margin = 12;
      if (rect.bottom + margin + bubbleHeight < window.innerHeight) {
        bubbleTop = rect.bottom + margin;
      } else if (rect.top - margin - bubbleHeight > 0) {
        bubbleTop = rect.top - margin - bubbleHeight;
      } else {
        bubbleTop = Math.max(margin, window.innerHeight - bubbleHeight - margin);
      }
      bubbleLeft = rect.left + rect.width / 2 - bubbleWidth / 2;
      bubbleLeft = Math.max(margin, Math.min(bubbleLeft, window.innerWidth - bubbleWidth - margin));
      bubbleTop = Math.round(bubbleTop);
      bubbleLeft = Math.round(bubbleLeft);
    } else {
      this.scrolledTarget = undefined;
    }

    if (JSON.stringify(highlight) !== JSON.stringify(this.highlight) || bubbleTop !== this.bubbleTop || bubbleLeft !== this.bubbleLeft) {
      this.highlight = highlight;
      this.bubbleTop = bubbleTop;
      this.bubbleLeft = bubbleLeft;
      this.cdr.markForCheck();
    }
  }

  next() {
    if (this.stepIndex < this.steps.length - 1) {
      this.stepIndex++;
      this.position();
    }
  }

  previous() {
    if (this.stepIndex > 0) {
      this.stepIndex--;
      this.position();
    }
  }

  toggleReference() {
    this.reference = !this.reference;
  }

  togglePhase(phase: GuidePhase) {
    this.openPhase = this.openPhase === phase ? undefined : phase;
  }

  toggleTopic(topic: string) {
    this.openTopic = this.openTopic === topic ? undefined : topic;
  }

  minimize() {
    settingsManager.set('guideModeMinimized', !settingsManager.settings.guideModeMinimized);
  }

  close() {
    settingsManager.set('guideMode', false);
  }
}
