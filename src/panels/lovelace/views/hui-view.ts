import {
  html,
  LitElement,
  property,
  internalProperty,
  PropertyValues,
  TemplateResult,
  CSSResult,
  css,
} from "lit-element";
import { classMap } from "lit-html/directives/class-map";
import { applyThemesOnElement } from "../../../common/dom/apply_themes_on_element";
import { computeRTL } from "../../../common/util/compute_rtl";
import "../../../components/entity/ha-state-label-badge";
import {
  LovelaceBadgeConfig,
  LovelaceCardConfig,
  LovelaceViewConfig,
} from "../../../data/lovelace";
import { HomeAssistant } from "../../../types";
import { HuiErrorCard } from "../cards/hui-error-card";
import { computeCardSize } from "../common/compute-card-size";
import { processConfigEntities } from "../common/process-config-entities";
import { createBadgeElement } from "../create-element/create-badge-element";
import { createCardElement } from "../create-element/create-card-element";
import { showEditCardDialog } from "../editor/card-editor/show-edit-card-dialog";
import { Lovelace, LovelaceBadge, LovelaceCard } from "../types";
import "../../../components/ha-svg-icon";
import { mdiPlus } from "@mdi/js";
import { nextRender } from "../../../common/util/render-status";

let editCodeLoaded = false;

// Find column with < 5 size, else smallest column
const getColumnIndex = (columnSizes: number[], size: number) => {
  let minIndex = 0;
  for (let i = 0; i < columnSizes.length; i++) {
    if (columnSizes[i] < 5) {
      minIndex = i;
      break;
    }
    if (columnSizes[i] < columnSizes[minIndex]) {
      minIndex = i;
    }
  }

  columnSizes[minIndex] += size;

  return minIndex;
};

export class HUIView extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public lovelace?: Lovelace;

  @property({ type: Number }) public columns?: number;

  @property({ type: Number }) public index?: number;

  @internalProperty() private _cards: Array<LovelaceCard | HuiErrorCard> = [];

  @internalProperty() private _badges: LovelaceBadge[] = [];

  private _createColumnsIteration = 0;

  public constructor() {
    super();
    this.addEventListener("iron-resize", (ev) => ev.stopPropagation());
  }

  // Public to make demo happy
  public createCardElement(cardConfig: LovelaceCardConfig) {
    const element = createCardElement(cardConfig) as LovelaceCard;
    element.hass = this.hass;
    element.addEventListener(
      "ll-rebuild",
      (ev) => {
        // In edit mode let it go to hui-root and rebuild whole view.
        if (!this.lovelace!.editMode) {
          ev.stopPropagation();
          this._rebuildCard(element, cardConfig);
        }
      },
      { once: true }
    );
    return element;
  }

  public createBadgeElement(badgeConfig: LovelaceBadgeConfig) {
    const element = createBadgeElement(badgeConfig) as LovelaceBadge;
    element.hass = this.hass;
    element.addEventListener(
      "ll-badge-rebuild",
      () => {
        this._rebuildBadge(element, badgeConfig);
      },
      { once: true }
    );
    return element;
  }

  protected render(): TemplateResult {
    return html`
      <div id="badges"></div>
      <div id="columns"></div>
      ${this.lovelace!.editMode
        ? html`
            <mwc-fab
              title="${this.hass!.localize(
                "ui.panel.lovelace.editor.edit_card.add"
              )}"
              @click="${this._addCard}"
              class="${classMap({
                rtl: computeRTL(this.hass!),
              })}"
            >
              <ha-svg-icon slot="icon" path=${mdiPlus}></ha-svg-icon>
            </mwc-fab>
          `
        : ""}
    `;
  }

  protected updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);

    const hass = this.hass!;
    const lovelace = this.lovelace!;

    if (lovelace.editMode && !editCodeLoaded) {
      editCodeLoaded = true;
      import(/* webpackChunkName: "hui-view-editable" */ "./hui-view-editable");
    }

    const hassChanged = changedProperties.has("hass");

    let editModeChanged = false;
    let configChanged = false;

    if (changedProperties.has("index")) {
      configChanged = true;
    } else if (changedProperties.has("lovelace")) {
      const oldLovelace = changedProperties.get("lovelace") as Lovelace;
      editModeChanged =
        oldLovelace && lovelace.editMode !== oldLovelace.editMode;
      configChanged = !oldLovelace || lovelace.config !== oldLovelace.config;
    }

    if (configChanged) {
      this._createBadges(lovelace.config.views[this.index!]);
    } else if (hassChanged) {
      this._badges.forEach((badge) => {
        badge.hass = hass;
      });
    }

    if (configChanged) {
      this._createCards(lovelace.config.views[this.index!]);
    } else if (editModeChanged || changedProperties.has("columns")) {
      this._createColumns();
    }

    if (hassChanged && !configChanged) {
      this._cards.forEach((element) => {
        element.hass = hass;
      });
    }

    const oldHass = changedProperties.get("hass") as this["hass"] | undefined;

    if (
      configChanged ||
      editModeChanged ||
      (hassChanged &&
        oldHass &&
        (hass.themes !== oldHass.themes ||
          hass.selectedTheme !== oldHass.selectedTheme))
    ) {
      applyThemesOnElement(
        this,
        hass.themes,
        lovelace.config.views[this.index!].theme
      );
    }
  }

  private _addCard(): void {
    showEditCardDialog(this, {
      lovelaceConfig: this.lovelace!.config,
      saveConfig: this.lovelace!.saveConfig,
      path: [this.index!],
    });
  }

  private _createBadges(config: LovelaceViewConfig): void {
    const root = this.shadowRoot!.getElementById("badges")!;

    while (root.lastChild) {
      root.removeChild(root.lastChild);
    }

    if (!config || !config.badges || !Array.isArray(config.badges)) {
      root.style.display = "none";
      this._badges = [];
      return;
    }

    const elements: HUIView["_badges"] = [];
    const badges = processConfigEntities(config.badges as any);
    badges.forEach((badge) => {
      const element = createBadgeElement(badge);
      element.hass = this.hass;
      elements.push(element);
      root.appendChild(element);
    });
    this._badges = elements;
    root.style.display = elements.length > 0 ? "block" : "none";
  }

  private async _createColumns() {
    this._createColumnsIteration++;
    const iteration = this._createColumnsIteration;
    const root = this.shadowRoot!.getElementById("columns")!;

    // Remove old columns
    while (root.lastChild) {
      root.removeChild(root.lastChild);
    }

    // Track the total height of cards in a columns
    const columnSizes: number[] = [];
    const columnElements: HTMLDivElement[] = [];
    // Add columns to DOM, limit number of columns to the number of cards
    for (let i = 0; i < Math.min(this.columns!, this._cards.length); i++) {
      const columnEl = document.createElement("div");
      columnEl.classList.add("column");
      root.appendChild(columnEl);
      columnSizes.push(0);
      columnElements.push(columnEl);
    }

    let tillNextRender: Promise<unknown> | undefined;
    let start: Date | undefined;

    // Calculate the size of every card and determine in what column it should go
    for (const [index, el] of this._cards.entries()) {
      if (tillNextRender === undefined) {
        // eslint-disable-next-line no-loop-func
        tillNextRender = nextRender().then(() => {
          tillNextRender = undefined;
          start = undefined;
        });
      }

      let waitProm: Promise<unknown> | undefined;

      // We should work for max 16ms (60fps) before allowing a frame to render
      if (start === undefined) {
        // Save the time we start for this frame, no need to wait yet
        start = new Date();
      } else if (new Date().getTime() - start.getTime() > 16) {
        // We are working too long, we will prevent a render, wait to allow for a render
        waitProm = tillNextRender;
      }

      const cardSizeProm = computeCardSize(el);
      // @ts-ignore
      // eslint-disable-next-line no-await-in-loop
      const [cardSize] = await Promise.all([cardSizeProm, waitProm]);

      if (iteration !== this._createColumnsIteration) {
        // An other create columns is started, abort this one
        return;
      }
      // Calculate in wich column the card should go based on the size and the cards already in there
      this._addCardToColumn(
        columnElements[getColumnIndex(columnSizes, cardSize as number)],
        index,
        this.lovelace!.editMode
      );
    }

    // Remove empty columns
    columnElements.forEach((column) => {
      if (!column.lastChild) {
        column.parentElement!.removeChild(column);
      }
    });
  }

  private _addCardToColumn(columnEl, index, editMode) {
    const card: LovelaceCard = this._cards[index];
    if (!editMode) {
      card.editMode = false;
      columnEl.appendChild(card);
    } else {
      const wrapper = document.createElement("hui-card-options");
      wrapper.hass = this.hass;
      wrapper.lovelace = this.lovelace;
      wrapper.path = [this.index!, index];
      card.editMode = true;
      wrapper.appendChild(card);
      columnEl.appendChild(wrapper);
    }
  }

  private _createCards(config: LovelaceViewConfig): void {
    if (!config || !config.cards || !Array.isArray(config.cards)) {
      this._cards = [];
      return;
    }

    const elements: LovelaceCard[] = [];
    config.cards.forEach((cardConfig) => {
      const element = this.createCardElement(cardConfig);
      elements.push(element);
    });

    this._cards = elements;
    this._createColumns();
  }

  private _rebuildCard(
    cardElToReplace: LovelaceCard,
    config: LovelaceCardConfig
  ): void {
    const newCardEl = this.createCardElement(config);
    if (cardElToReplace.parentElement) {
      cardElToReplace.parentElement!.replaceChild(newCardEl, cardElToReplace);
    }
    this._cards = this._cards!.map((curCardEl) =>
      curCardEl === cardElToReplace ? newCardEl : curCardEl
    );
  }

  private _rebuildBadge(
    badgeElToReplace: LovelaceBadge,
    config: LovelaceBadgeConfig
  ): void {
    const newBadgeEl = this.createBadgeElement(config);
    badgeElToReplace.parentElement!.replaceChild(newBadgeEl, badgeElToReplace);
    this._badges = this._cards!.map((curBadgeEl) =>
      curBadgeEl === badgeElToReplace ? newBadgeEl : curBadgeEl
    );
  }

  static get styles(): CSSResult {
    return css`
      :host {
        display: block;
        box-sizing: border-box;
        padding: 4px 4px 0;
        transform: translateZ(0);
        position: relative;
        color: var(--primary-text-color);
        background: var(--lovelace-background, var(--primary-background-color));
      }

      #badges {
        margin: 8px 16px;
        font-size: 85%;
        text-align: center;
      }

      #columns {
        display: flex;
        flex-direction: row;
        justify-content: center;
      }

      .column {
        flex: 1 0 0;
        max-width: 500px;
        min-width: 0;
      }

      .column > * {
        display: block;
        margin: 4px 4px 8px;
      }

      mwc-fab {
        position: sticky;
        float: right;
        bottom: 16px;
        right: 16px;
        z-index: 1;
      }

      mwc-fab.rtl {
        float: left;
        right: auto;
        left: 16px;
      }

      @media (max-width: 500px) {
        :host {
          padding-left: 0;
          padding-right: 0;
        }

        .column > * {
          margin-left: 0;
          margin-right: 0;
        }
      }

      @media (max-width: 599px) {
        .column {
          max-width: 600px;
        }
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hui-view": HUIView;
  }
}

customElements.define("hui-view", HUIView);
