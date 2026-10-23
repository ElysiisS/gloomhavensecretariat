import { NgClass } from '@angular/common';
import { Component, inject } from '@angular/core';
import { GameManager, gameManager } from 'src/app/game/businesslogic/GameManager';
import { GhsManager } from 'src/app/game/businesslogic/GhsManager';
import { SettingsManager, settingsManager } from 'src/app/game/businesslogic/SettingsManager';
import { Character } from 'src/app/game/model/Character';
import { ConditionName, EntityCondition } from 'src/app/game/model/data/Condition';
import { ElementState } from 'src/app/game/model/data/Element';
import { GameState } from 'src/app/game/model/Game';
import { Monster } from 'src/app/game/model/Monster';
import { GhsLabelDirective } from 'src/app/ui/helper/label';

export type GuidePhase = 'setup' | 'cardSelection' | 'turns' | 'roundEnd' | 'scenarioEnd';

export type GuideTip = { label: string; args?: string[]; type?: 'info' | 'todo' | 'warning' };

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

@Component({
  imports: [NgClass, GhsLabelDirective],
  selector: 'ghs-guide',
  templateUrl: './guide.html',
  styleUrls: ['./guide.scss']
})
export class GuideComponent {
  private ghsManager = inject(GhsManager);

  gameManager: GameManager = gameManager;
  settingsManager: SettingsManager = settingsManager;
  GuidePhases = GuidePhases;
  GuideTopics = GuideTopics;
  GuideConditions = GuideConditions;

  tab: 'now' | 'round' | 'rules' = 'now';
  phase: GuidePhase = 'setup';
  tips: GuideTip[] = [];
  openPhase: GuidePhase | undefined;
  openTopic: string | undefined;

  constructor() {
    this.ghsManager.uiChangeEffect(() => this.update());
  }

  update() {
    const game = gameManager.game;
    const characters = game.figures.filter((figure) => figure instanceof Character) as Character[];
    const monsters = game.figures.filter((figure) => figure instanceof Monster) as Monster[];
    const tips: GuideTip[] = [];

    if (game.finish) {
      this.phase = 'scenarioEnd';
      tips.push({ label: 'guide.now.scenarioEnd' });
    } else if (characters.length === 0) {
      this.phase = 'setup';
      tips.push({ label: 'guide.now.noCharacters', type: 'todo' });
      if (!game.scenario) {
        tips.push({ label: 'guide.now.noScenario', type: 'todo' });
      }
    } else if (game.state === GameState.draw) {
      this.phase = 'cardSelection';
      if (!game.scenario && monsters.length === 0) {
        tips.push({ label: 'guide.now.noScenario', type: 'todo' });
      }
      if (game.round === 0) {
        tips.push({ label: 'guide.now.firstRound' });
      }
      tips.push({ label: 'guide.now.chooseCards' });
      tips.push({ label: 'guide.now.longRestOption' });
      const missing = characters.filter(
        (character) =>
          gameManager.entityManager.isAlive(character) && !character.absent && !character.exhausted && character.getInitiative() <= 0
      );
      if (missing.length > 0) {
        tips.push({
          label: 'guide.now.missingInitiative',
          args: [missing.map((character) => gameManager.characterManager.characterName(character)).join(', ')],
          type: 'todo'
        });
      } else {
        tips.push({ label: 'guide.now.readyToDraw', type: 'todo' });
      }
    } else {
      const active = game.figures.find((figure) => figure.active && !figure.off);
      if (active instanceof Character) {
        this.phase = 'turns';
        tips.push({ label: 'guide.now.characterTurn', args: [gameManager.characterManager.characterName(active)] });
        if (active.longRest) {
          tips.push({ label: 'guide.now.longRest', type: 'todo' });
        } else {
          tips.push({ label: 'guide.now.playCards', type: 'todo' });
          tips.push({ label: 'guide.now.attackHint' });
        }
        if (active.summons.some((summon) => gameManager.entityManager.isAlive(summon))) {
          tips.push({ label: 'guide.now.summons' });
        }
        this.conditionTips(active.entityConditions, tips);
        tips.push({ label: 'guide.now.endTurnCharacter', type: 'todo' });
      } else if (active instanceof Monster) {
        this.phase = 'turns';
        tips.push({ label: 'guide.now.monsterTurn', args: [settingsManager.getLabel('data.monster.' + active.name)] });
        tips.push({ label: 'guide.now.monsterOrder' });
        tips.push({ label: 'guide.now.monsterFocus' });
        tips.push({ label: 'guide.now.monsterAttack' });
        const abilityCard = gameManager.monsterManager.getAbilityCard(active);
        if (abilityCard && abilityCard.shuffle) {
          tips.push({ label: 'guide.now.monsterShuffle' });
        }
        const conditions: EntityCondition[] = [];
        active.entities
          .filter((entity) => gameManager.entityManager.isAlive(entity))
          .forEach((entity) => conditions.push(...entity.entityConditions));
        this.conditionTips(conditions, tips);
        tips.push({ label: 'guide.now.endTurn', type: 'todo' });
      } else if (active) {
        this.phase = 'turns';
        tips.push({ label: 'guide.now.otherTurn', type: 'todo' });
      } else {
        this.phase = 'roundEnd';
        tips.push({ label: 'guide.now.roundEnd' });
        if (this.monsterDeckShuffle(game.monsterAttackModifierDeck.cards, game.monsterAttackModifierDeck.current)) {
          tips.push({ label: 'guide.now.monsterModifierShuffle' });
        }
        characters
          .filter((character) => this.monsterDeckShuffle(character.attackModifierDeck.cards, character.attackModifierDeck.current))
          .forEach((character) =>
            tips.push({ label: 'guide.now.characterModifierShuffle', args: [gameManager.characterManager.characterName(character)] })
          );
        tips.push({ label: 'guide.now.shortRest' });
        tips.push({ label: 'guide.now.nextRound', type: 'todo' });
      }
    }

    const elements = game.elementBoard.filter((element) => element.state === ElementState.strong || element.state === ElementState.waning);
    if (elements.length > 0 && this.phase !== 'setup' && this.phase !== 'scenarioEnd') {
      tips.push({
        label: 'guide.now.elements',
        args: [elements.map((element) => '%game.element.' + element.type + '%').join(' ')]
      });
    }

    const exhausted = characters.filter((character) => character.exhausted && !character.absent);
    if (exhausted.length > 0 && this.phase !== 'scenarioEnd') {
      tips.push({
        label: 'guide.now.exhausted',
        args: [exhausted.map((character) => gameManager.characterManager.characterName(character)).join(', ')],
        type: 'warning'
      });
    }

    if (
      game.scenario &&
      this.phase !== 'scenarioEnd' &&
      characters.length > 0 &&
      characters.every((character) => character.exhausted || character.absent || !gameManager.entityManager.isAlive(character))
    ) {
      tips.push({ label: 'guide.now.allExhausted', type: 'warning' });
    }

    this.tips = tips;
  }

  conditionTips(entityConditions: EntityCondition[], tips: GuideTip[]) {
    const names: ConditionName[] = [];
    entityConditions
      .filter((condition) => !condition.expired && GuideConditions.includes(condition.name))
      .forEach((condition) => {
        if (!names.includes(condition.name)) {
          names.push(condition.name);
        }
      });
    names.forEach((name) => tips.push({ label: 'guide.condition.' + name, type: 'warning' }));
  }

  monsterDeckShuffle(cards: { shuffle: boolean }[], current: number): boolean {
    return cards.slice(0, current + 1).some((card) => card && card.shuffle);
  }

  phaseActive(phase: GuidePhase): boolean {
    return this.phase === phase;
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
