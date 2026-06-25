(function (global) {
  "use strict";

  const RingMapChart = global.RingMapChart;
  const { config, model, storage, utils } = RingMapChart;
  const WELCOME_KEY = "ring-map-chart-welcome-v1";
  const DEFAULT_BRANCH_COLORS = config.colors.slice();
  const MANAGED_THEME_TOKEN_KEYS = Array.from(new Set(
    Object.values(config.themePresets)
      .flatMap((preset) => Object.keys(preset.tokens))
      .concat(config.themeTokenControls.map((control) => control.key))
      .concat(["canvas-grid", "label", "node-ink", "root-node-ink"])
  ));
  const MANAGED_STYLE_TOKEN_KEYS = [
    "bg",
    "surface",
    "surface-solid",
    "surface-raised",
    "surface-recessed",
    "glass-border",
    "hairline",
    "field",
    "field-hover",
    "control",
    "control-hover",
    "control-pressed",
    "control-ink",
    "focus",
    "focus-soft",
    "ink",
    "muted",
    "label",
    "canvas-bg",
    "canvas-grid",
    "canvas-wash",
    "ring-guide",
    "node-fill",
    "node-ink",
    "root-node-fill",
    "root-node-ink",
    "shadow-sm",
    "shadow-md",
    "shadow-lg",
    "node-shadow"
  ];

  function Controller(elements) {
    this.el = elements;
    this.layoutEngine = RingMapChart.createLayoutEngine();
    this.renderer = new RingMapChart.Renderer(elements.svg, this.layoutEngine);
    this.spacing = storage.normalizeSpacing(null, config.spacingDefaults);
    this.appearance = storage.normalizeAppearance(null, config.appearanceDefaults);
    this.store = model.createStore();
    this.mind = model.createMindFromTree(this.store.tree);
    this.maps = [];
    this.activeMapId = null;
    this.downMapStack = [];
    this.theme = "light";
    this.customTheme = storage.normalizeCustomTheme(null);
    this.branchColors = DEFAULT_BRANCH_COLORS.slice();
    this.viewMode = "ring";
    this.viewport = { width: config.layout.minViewportWidth, height: config.layout.minViewportHeight };
    this.world = { width: config.layout.minViewportWidth, height: config.layout.minViewportHeight };
    this.positions = new Map();
    this.camera = { x: 0, y: 0, scale: 1 };
    this.cameraReady = false;
    this.renderQueued = false;
    this.editingId = null;
    this.animatedNewNodeId = null;
    this.noteCloseTimer = null;
    this.isSpaceDown = false;
    this.isPointerOverCanvas = false;
    this.isPanning = false;
    this.panStart = null;
    this.nodeDrag = null;
    this.layoutAnimationPositions = null;
    this.shouldRevealFocus = true;
    this.previousRenderedFocusId = null;
    this.actionBarOpen = false;
    this.undoStack = [];
    this.redoStack = [];
    this.paletteItems = [];
    this.paletteIndex = 0;
    this.nodeLinkItems = [];
    this.nodeLinkIndex = 0;
    this.nodeLinkRange = null;
    this.saveStateTimer = null;
    this.recentMinds = [];
  }

  Controller.prototype.start = function () {
    this.load();
    this.bindEvents();
    this.syncControls();
    this.render();
    this.showWelcomeIfNeeded();
    this.el.svg.focus();
  };

  Controller.prototype.load = function () {
    this.recentMinds = loadRecentMinds();
    const saved = storage.load();
    if (!saved) {
      this.store = model.createStore();
      this.mind = model.createMindFromTree(this.store.tree);
      const map = this.createMap(model.ROOT_ID, "Chart Title");
      this.maps = [map];
      this.activeMapId = map.id;
      this.refreshViewTree();
      return;
    }
    this.mind = saved.mind;
    this.maps = saved.maps;
    this.activeMapId = saved.activeMapId;
    this.appearance = storage.normalizeAppearance(saved.appearance, config.appearanceDefaults);
    this.theme = saved.theme;
    this.customTheme = storage.normalizeCustomTheme(saved.customTheme);
    this.branchColors = storage.normalizeBranchColors(saved.branchColors);
    this.loadMap(this.currentMap());
  };

  Controller.prototype.bindEvents = function () {
    this.el.titleInput.addEventListener("input", () => {
      const label = utils.cleanLabel(this.el.titleInput.value) || "Chart Title";
      const map = this.currentMap();
      if (map) {
        model.renameMindNode(this.mind, map.rootNodeId, label);
        map.title = label;
        this.refreshViewTree();
      }
      if (this.store.focusedId === model.ROOT_ID) this.el.nodeLabelInput.value = label;
      this.save();
      this.scheduleRender(true);
    });

    this.el.mapSelect.addEventListener("change", () => this.switchMap(this.el.mapSelect.value));
    this.el.parentMapButton.addEventListener("click", () => this.openParentMap());
    this.el.childMapButton.addEventListener("click", () => this.openRecentChildMap());
    this.el.newMapButton.addEventListener("click", () => this.newMap());
    this.el.deleteMapButton.addEventListener("click", () => this.deleteActiveMap());
    this.el.newMindButton.addEventListener("click", () => this.newMind());
    this.el.saveMindButton.addEventListener("click", () => {
      this.save();
      this.updateStatus("Mind saved");
    });
    this.el.commandPaletteButton.addEventListener("click", () => this.openCommandPalette());
    this.el.commandInput.addEventListener("input", () => this.renderCommandResults());
    this.el.commandInput.addEventListener("keydown", (event) => this.handleCommandKey(event));
    this.el.commandPalette.addEventListener("pointerdown", (event) => {
      if (event.target === this.el.commandPalette) this.closeCommandPalette();
    });
    if (this.el.welcomeCloseButton) this.el.welcomeCloseButton.addEventListener("click", () => this.closeWelcome());
    if (this.el.welcomeCommandButton) this.el.welcomeCommandButton.addEventListener("click", () => {
      this.closeWelcome();
      this.openCommandPalette();
    });
    if (this.el.welcomeTutorialButton) this.el.welcomeTutorialButton.addEventListener("click", () => this.startTutorial());
    if (this.el.welcomeDialog) this.el.welcomeDialog.addEventListener("pointerdown", (event) => {
      if (event.target === this.el.welcomeDialog) this.closeWelcome();
    });
    if (this.el.welcomeTemplates) this.el.welcomeTemplates.addEventListener("click", (event) => {
      const button = event.target.closest && event.target.closest("button[data-template]");
      if (button) this.applyWelcomeTemplate(button.dataset.template);
    });
    if (this.el.welcomeStyles) this.el.welcomeStyles.addEventListener("click", (event) => {
      const button = event.target.closest && event.target.closest("button[data-style]");
      if (button) this.applyWelcomeStyle(button.dataset.style);
    });
    this.el.exportMindButton.addEventListener("click", () => this.exportMind());
    this.el.importMindInput.addEventListener("change", () => this.importMind());
    if (this.el.clearRecentMindsButton) this.el.clearRecentMindsButton.addEventListener("click", () => this.clearRecentMinds());
    [this.el.mindMenu, this.el.settingsMenu].forEach((menu) => {
      if (!menu) return;
      menu.addEventListener("toggle", () => {
        if (!menu.open) return;
        [this.el.mindMenu, this.el.settingsMenu].forEach((other) => {
          if (other && other !== menu) other.open = false;
        });
      });
    });

    this.el.viewModeInput.addEventListener("change", () => {
      this.viewMode = this.el.viewModeInput.checked ? "ring" : "tree";
      this.save();
      this.scheduleRender(true);
    });
    if (this.el.stylePresetInput) {
      this.el.stylePresetInput.addEventListener("change", () => {
        this.appearance.stylePreset = storage.normalizeStylePreset(this.el.stylePresetInput.value);
        this.applyTheme();
        this.applyAppearance();
        this.save();
        this.updateStatus("Style changed");
      });
    }
    if (this.el.navigationModeInput) {
      this.el.navigationModeInput.addEventListener("change", () => {
        this.appearance.navigationMode = storage.normalizeNavigationMode(this.el.navigationModeInput.value);
        this.save();
        this.updateStatus("Navigation changed");
      });
    }
    Object.entries(this.el.appearanceInputs).forEach(([key, input]) => {
      input.addEventListener("change", () => {
        const limits = config.appearanceLimits[key];
        this.appearance[key] = utils.clampNumber(input.value, limits.min, limits.max, this.appearance[key]);
        this.syncAppearanceInputs(true);
        this.applyAppearance();
        this.save();
        this.shouldRevealFocus = true;
        this.render();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    });
    Object.entries(this.el.appearanceToggles || {}).forEach(([key, input]) => {
      if (!input) return;
      input.addEventListener("change", () => {
        this.appearance[key] = Boolean(input.checked);
        this.syncAppearanceInputs(true);
        this.save();
        this.scheduleRender(false);
      });
    });

    this.el.themePresetInput.addEventListener("change", () => {
      this.theme = storage.normalizeTheme(this.el.themePresetInput.value);
      this.applyTheme();
      this.applyAppearance();
      this.save();
      this.syncThemeControls();
      this.updateStatus("Theme changed");
    });
    this.el.shufflePaletteButton.addEventListener("click", () => this.shuffleBranchPalette());
    this.el.resetPaletteButton.addEventListener("click", () => this.resetBranchPalette());
    this.el.exportThemeButton.addEventListener("click", () => this.exportTheme());
    this.el.importThemeInput.addEventListener("change", () => this.importTheme());

    Object.entries(this.el.spacingInputs).forEach(([key, input]) => {
      input.addEventListener("change", () => {
        const limits = config.spacingLimits[key];
        this.spacing[key] = utils.clampNumber(input.value, limits.min, limits.max, this.spacing[key]);
        this.syncSpacingInputs(true);
        this.save();
        this.shouldRevealFocus = true;
        this.render();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    });

    this.el.addButton.addEventListener("click", () => this.addNode());
    this.el.renameButton.addEventListener("click", () => this.renameFocused());
    this.el.openMapButton.addEventListener("click", () => this.createMapFromFocusedNode());
    this.el.reparentButton.addEventListener("click", () => this.createParentForFocusedNode());
    this.el.noteButton.addEventListener("click", () => this.toggleNoteSidebar());
    this.el.closeNoteButton.addEventListener("click", () => this.closeNoteSidebar());
    this.el.deleteButton.addEventListener("click", () => this.deleteFocused());
    this.el.resetButton.addEventListener("click", () => this.reset());
    this.el.nodeLabelInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.renameFocused();
      }
    });
    this.el.noteInput.addEventListener("input", () => {
      this.saveFocusedNote();
      this.renderNodeLinkSuggest();
    });
    this.el.nodeStatusInput.addEventListener("change", () => this.saveFocusedNote());
    this.el.nodePriorityInput.addEventListener("change", () => this.saveFocusedNote());
    if (this.el.nodeMarkerInput) this.el.nodeMarkerInput.addEventListener("change", () => this.saveFocusedNote());
    this.el.nodeTagsInput.addEventListener("change", () => this.saveFocusedNote());
    this.el.noteInput.addEventListener("keydown", (event) => {
      if (this.handleNodeLinkSuggestKey(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeNoteSidebar();
      }
    });
    this.el.noteSidebar.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        this.focusNoteSourceNode();
      }
    });

    this.el.nodeEditor.hidden = true;
    this.el.nodeEditor.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.finishEdit(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.finishEdit(false);
      }
    });
    this.el.nodeEditor.addEventListener("blur", () => this.finishEdit(true));

    document.addEventListener("pointerdown", (event) => this.handleDocumentPointerDown(event));
    this.el.svg.addEventListener("keydown", (event) => this.handleCanvasKey(event));
    this.el.svg.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
    this.el.svg.addEventListener("pointerenter", () => {
      this.isPointerOverCanvas = true;
      if (this.isSpaceDown) this.el.svg.classList.add("space-pan-ready");
      if (!utils.isEditableTarget(document.activeElement)) this.el.svg.focus();
    });
    this.el.svg.addEventListener("pointerleave", () => {
      if (!this.isPanning) this.isPointerOverCanvas = false;
    });
    this.el.svg.addEventListener("pointerdown", (event) => this.startPan(event));

    window.addEventListener("pointermove", (event) => {
      this.moveNodeDrag(event);
      this.movePan(event);
    });
    window.addEventListener("pointerup", (event) => {
      this.endNodeDrag(event);
      this.endPan(event);
    });
    window.addEventListener("pointercancel", (event) => {
      this.cancelNodeDrag(event);
      this.endPan(event);
    });
    window.addEventListener("keydown", (event) => this.handleGlobalKeyDown(event));
    window.addEventListener("keyup", (event) => this.handleGlobalKeyUp(event));
    window.addEventListener("blur", () => this.clearPanKeys());
    window.addEventListener("resize", () => {
      this.scheduleRender(false);
      this.positionEditor();
      this.positionActionBar();
    });
  };

  Controller.prototype.handleCanvasKey = function (event) {
    if (event.key === "ArrowLeft" && event.ctrlKey) {
      event.preventDefault();
      this.openParentMap();
    } else if (event.key === "ArrowRight" && event.ctrlKey) {
      event.preventDefault();
      this.openRecentChildMap();
    } else if (event.key === "Enter" && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      this.createParentForFocusedNode();
    } else if (event.key === "Enter" && event.ctrlKey && !event.altKey) {
      event.preventDefault();
      this.toggleNoteSidebar();
    } else if (event.key === "Enter" && event.altKey) {
      event.preventDefault();
      this.createMapFromFocusedNode();
    } else if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      this.startEdit(this.store.focusedId);
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.addNode(true);
    } else if (this.keyToNavigationArrow(event)) {
      event.preventDefault();
      const mode = event.shiftKey ? "outline" : this.appearance.navigationMode;
      if (model.focusRelative(this.store, this.keyToNavigationArrow(event), this.positions, mode)) {
        this.actionBarOpen = false;
        this.afterTreeChange(false, true);
      }
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deleteFocused();
    }
  };

  Controller.prototype.keyToNavigationArrow = function (event) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return event.key;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
    const key = String(event.key || "").toLowerCase();
    return {
      w: "ArrowUp",
      a: "ArrowLeft",
      s: "ArrowDown",
      d: "ArrowRight",
      k: "ArrowUp",
      h: "ArrowLeft",
      j: "ArrowDown",
      l: "ArrowRight"
    }[key] || null;
  };

  Controller.prototype.handleDocumentPointerDown = function (event) {
    if (!this.actionBarOpen) return;
    const target = event.target;
    if (this.el.nodeActionBar && this.el.nodeActionBar.contains(target)) return;
    if (this.el.nodeEditor && this.el.nodeEditor.contains(target)) return;
    if (target.closest && target.closest(".node")) return;
    this.actionBarOpen = false;
    this.positionActionBar();
  };

  Controller.prototype.handleWheel = function (event) {
    event.preventDefault();
    if (this.editingId) this.finishEdit(true);
    if (event.ctrlKey) {
      this.zoomAt(event.clientX, event.clientY, event.deltaY);
      return;
    }
    const amount = normalizeWheelDelta(event, event.shiftKey ? "x" : "y") / this.camera.scale;
    if (event.shiftKey) this.camera.x += amount;
    else this.camera.y += amount;
    this.clampCamera();
    this.scheduleRender(false);
  };

  Controller.prototype.handleGlobalKeyDown = function (event) {
    if (event.defaultPrevented) return;
    const editableTarget = utils.isEditableTarget(document.activeElement);
    if (event.key === "Escape" && this.nodeDrag) {
      event.preventDefault();
      this.cancelNodeDrag();
      return;
    }
    if (event.key === "Escape" && this.el.noteSidebar && !this.el.noteSidebar.hidden) {
      event.preventDefault();
      this.closeNoteSidebar();
      return;
    }
    if ((event.key === "k" || event.key === "K") && (event.ctrlKey || event.metaKey) && !editableTarget) {
      event.preventDefault();
      this.openCommandPalette();
      return;
    }
    if ((event.key === "z" || event.key === "Z") && (event.ctrlKey || event.metaKey) && event.shiftKey && !editableTarget) {
      event.preventDefault();
      this.redo();
      return;
    }
    if ((event.key === "z" || event.key === "Z") && (event.ctrlKey || event.metaKey) && !editableTarget) {
      event.preventDefault();
      this.undo();
      return;
    }
    if ((event.key === "y" || event.key === "Y") && (event.ctrlKey || event.metaKey) && !editableTarget) {
      event.preventDefault();
      this.redo();
      return;
    }
    if (event.key === "Enter" && event.ctrlKey && !event.shiftKey && !event.altKey && !editableTarget) {
      event.preventDefault();
      this.toggleNoteSidebar();
      return;
    }
    if (event.code !== "Space" || editableTarget) return;
    event.preventDefault();
    this.isSpaceDown = true;
    if (this.isPointerOverCanvas || document.activeElement === this.el.svg) {
      this.el.svg.classList.add("space-pan-ready");
      this.el.svg.focus();
    }
  };

  Controller.prototype.handleGlobalKeyUp = function (event) {
    if (event.code !== "Space") return;
    this.isSpaceDown = false;
    this.el.svg.classList.remove("space-pan-ready");
    this.endPan(event);
  };

  Controller.prototype.clearPanKeys = function () {
    this.isSpaceDown = false;
    this.el.svg.classList.remove("space-pan-ready");
    this.endPan();
  };

  Controller.prototype.addNode = function (editAfterAdd) {
    const found = model.findNode(this.store.tree, this.store.focusedId);
    const map = this.currentMap();
    const sourceId = found && map ? model.sourceIdForViewNode(found.node, map.rootNodeId) : null;
    if (found && sourceId && found.node.depth < config.limits.maxDepth && found.node.children.length < config.limits.maxChildren) {
      this.pushUndoSnapshot();
    }
    const childId = found && sourceId ? model.addMindChild(this.mind, sourceId, found.node.depth, found.node.children.length) : null;
    if (!childId) {
      this.updateStatus();
      return;
    }
    this.animatedNewNodeId = childId;
    this.actionBarOpen = false;
    this.refreshViewTree(childId);
    this.afterTreeChange(true, true);
    if (editAfterAdd) this.startEdit(childId);
    else this.el.svg.focus();
  };

  Controller.prototype.renameFocused = function () {
    const found = model.findNode(this.store.tree, this.store.focusedId);
    const map = this.currentMap();
    const sourceId = found && map ? model.sourceIdForViewNode(found.node, map.rootNodeId) : null;
    if (!sourceId) return;
    const nextLabel = utils.cleanLabel(this.el.nodeLabelInput.value);
    if (!nextLabel || this.mind.nodes[sourceId].label === nextLabel) return;
    this.pushUndoSnapshot();
    if (!model.renameMindNode(this.mind, sourceId, nextLabel)) return;
    if (found.node.id === model.ROOT_ID && map) map.title = this.mind.nodes[sourceId].label;
    this.refreshViewTree(this.store.focusedId);
    this.afterTreeChange(true, true);
    this.el.svg.focus();
  };

  Controller.prototype.deleteFocused = function () {
    const found = model.findNode(this.store.tree, this.store.focusedId);
    if (!found || this.store.focusedId === model.ROOT_ID) return;
    if (found.node.children.length && !confirm("Delete node and all child nodes?")) return;
    const map = this.currentMap();
    const sourceId = map ? model.sourceIdForViewNode(found.node, map.rootNodeId) : null;
    this.pushUndoSnapshot();
    this.showDeletedNodeGhost(found.node);
    const nextSourceId = sourceId ? model.deleteMindNode(this.mind, sourceId) : null;
    if (!nextSourceId) return;
    this.maps = this.maps.filter((item) => item.rootNodeId !== sourceId);
    if (!this.currentMap()) this.activeMapId = this.maps[0].id;
    this.refreshViewTree(nextSourceId === map.rootNodeId ? model.ROOT_ID : nextSourceId);
    this.hideEditor();
    this.closeNoteSidebar(false);
    this.actionBarOpen = false;
    this.afterTreeChange(true, true);
    this.el.svg.focus();
  };

  Controller.prototype.createParentForFocusedNode = function () {
    if (this.editingId) this.finishEdit(true);
    this.actionBarOpen = false;
    const found = model.findNode(this.store.tree, this.store.focusedId);
    const map = this.currentMap();
    if (!found || !map) {
      this.updateStatus("Ctrl+Shift+Enter needs child focus");
      return;
    }
    const isMapRoot = found.node.id === model.ROOT_ID;
    const sourceId = model.sourceIdForViewNode(found.node, map.rootNodeId);
    if (isMapRoot && sourceId === this.mind.rootId) {
      this.updateStatus("Mind root has no parent");
      return;
    }
    this.pushUndoSnapshot();
    const subtreeAtMaxDepth = maxDepth(found.node) >= config.limits.maxDepth;
    if (subtreeAtMaxDepth || isMapRoot) this.ensureMapForNode(sourceId, map.id);
    const wrapperId = model.wrapMindNode(this.mind, sourceId, found.node.depth);
    if (!wrapperId) {
      this.updateStatus("Cannot create parent");
      return;
    }
    if (isMapRoot) {
      map.rootNodeId = wrapperId;
      map.title = this.mind.nodes[wrapperId].label;
      const childMap = this.maps.find((item) => item.rootNodeId === sourceId && item.id !== map.id);
      if (childMap) this.downMapStack.push(childMap.id);
      this.refreshViewTree(model.ROOT_ID);
      this.store.focusedId = model.ROOT_ID;
      map.focusedId = model.ROOT_ID;
    } else {
      this.refreshViewTree(wrapperId);
      this.store.focusedId = wrapperId;
      map.focusedId = wrapperId;
    }
    this.afterTreeChange(true, true);
    if (subtreeAtMaxDepth) this.updateStatus("Created child map; leaves hidden here");
    this.el.svg.focus();
  };

  Controller.prototype.reset = function () {
    if (!confirm("Reset ring map chart?")) return;
    this.pushUndoSnapshot();
    this.store = model.createStore();
    this.mind = model.createMindFromTree(this.store.tree);
    this.maps = [this.createMap(model.ROOT_ID, this.store.tree.label)];
    this.activeMapId = this.maps[0].id;
    this.viewMode = "ring";
    this.spacing = storage.normalizeSpacing(null, config.spacingDefaults);
    this.appearance = storage.normalizeAppearance(null, config.appearanceDefaults);
    this.theme = "light";
    this.customTheme = storage.normalizeCustomTheme(null);
    this.branchColors = DEFAULT_BRANCH_COLORS.slice();
    this.hideEditor();
    this.closeNoteSidebar(false);
    this.actionBarOpen = false;
    this.cameraReady = false;
    this.afterTreeChange(true, true);
  };

  Controller.prototype.currentMap = function () {
    return this.maps.find((map) => map.id === this.activeMapId) || null;
  };

  Controller.prototype.refreshViewTree = function (focusedId) {
    const map = this.currentMap();
    if (!map || !this.mind.nodes[map.rootNodeId]) return;
    this.store.tree = model.viewTree(this.mind, map.rootNodeId);
    const nextFocus = focusedId || map.focusedId || model.ROOT_ID;
    this.store.focusedId = model.findNode(this.store.tree, nextFocus) ? nextFocus : model.ROOT_ID;
    map.focusedId = this.store.focusedId;
  };

  Controller.prototype.createMap = function (rootNodeId, title) {
    const source = this.mind.nodes[rootNodeId] || this.mind.nodes[this.mind.rootId];
    return {
      id: this.nextMapId(),
      title: utils.cleanLabel(title || source.label) || "Chart Title",
      rootNodeId: source.id,
      focusedId: model.ROOT_ID,
      viewMode: this.viewMode,
      spacing: storage.normalizeSpacing(this.spacing, config.spacingDefaults)
    };
  };

  Controller.prototype.nextMapId = function () {
    let id;
    do {
      id = "map-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    } while (this.maps.some((map) => map.id === id));
    return id;
  };

  Controller.prototype.loadMap = function (map) {
    if (!map) return;
    this.viewMode = map.viewMode;
    this.spacing = storage.normalizeSpacing(map.spacing, config.spacingDefaults);
    this.refreshViewTree(map.focusedId);
    this.cameraReady = false;
    this.shouldRevealFocus = true;
  };

  Controller.prototype.captureActiveMap = function () {
    const map = this.currentMap();
    if (!map) return;
    map.title = this.mind.nodes[map.rootNodeId] ? this.mind.nodes[map.rootNodeId].label : map.title;
    map.focusedId = this.store.focusedId;
    map.viewMode = this.viewMode;
    map.spacing = storage.normalizeSpacing(this.spacing, config.spacingDefaults);
  };

  Controller.prototype.switchMap = function (id) {
    const next = this.maps.find((map) => map.id === id);
    if (!next || next.id === this.activeMapId) return;
    this.openMap(next);
  };

  Controller.prototype.openMap = function (next) {
    this.hideEditor();
    this.closeNoteSidebar(false);
    this.actionBarOpen = false;
    this.captureActiveMap();
    this.activeMapId = next.id;
    this.loadMap(next);
    this.save();
    this.syncControls();
    this.render();
    this.animateCanvasSwap();
    this.el.svg.focus();
  };

  Controller.prototype.newMind = function () {
    this.rememberCurrentMind();
    this.pushUndoSnapshot();
    this.store = model.createStore();
    this.mind = model.createMindFromTree(this.store.tree);
    this.maps = [this.createMap(model.ROOT_ID, this.store.tree.label)];
    this.activeMapId = this.maps[0].id;
    this.downMapStack = [];
    this.viewMode = "ring";
    this.spacing = storage.normalizeSpacing(null, config.spacingDefaults);
    this.appearance = storage.normalizeAppearance(null, config.appearanceDefaults);
    this.hideEditor();
    this.closeNoteSidebar(false);
    this.actionBarOpen = false;
    this.cameraReady = false;
    this.loadMap(this.currentMap());
    this.applyTheme();
    this.save();
    this.syncControls();
    this.render();
    this.animateCanvasSwap();
    this.updateStatus("New mind created; previous mind in Recent");
    this.el.svg.focus();
  };

  Controller.prototype.openParentMap = function () {
    const map = this.currentMap();
    if (!map || map.rootNodeId === this.mind.rootId) {
      this.updateStatus("Already at mind root");
      return;
    }
    const parentId = model.findMindParentId(this.mind, map.rootNodeId);
    if (!parentId) {
      this.updateStatus("No parent map");
      return;
    }
    const parentMap = this.ensureMapForNode(parentId);
    if (!parentMap) return;
    this.downMapStack.push(map.id);
    this.openMap(parentMap);
  };

  Controller.prototype.openRecentChildMap = function () {
    while (this.downMapStack.length) {
      const mapId = this.downMapStack.pop();
      const map = this.maps.find((item) => item.id === mapId);
      if (map && this.mind.nodes[map.rootNodeId]) {
        this.openMap(map);
        return;
      }
    }
    this.updateStatus("No recent child map");
  };

  Controller.prototype.newMap = function () {
    this.hideEditor();
    this.actionBarOpen = false;
    this.captureActiveMap();
    this.pushUndoSnapshot();
    const rootId = model.addMindChild(this.mind, this.mind.rootId, 0, this.mind.nodes[this.mind.rootId].children.length);
    if (!rootId) {
      this.updateStatus("Root map children max reached");
      return;
    }
    const map = this.createMap(rootId, this.mind.nodes[rootId].label);
    this.maps.push(map);
    this.activeMapId = map.id;
    this.loadMap(map);
    this.save();
    this.syncControls();
    this.render();
    this.animateCanvasSwap();
    this.el.svg.focus();
  };

  Controller.prototype.deleteActiveMap = function () {
    if (this.maps.length <= 1) {
      this.reset();
      return;
    }
    if (!confirm("Delete current ring map?")) return;
    this.pushUndoSnapshot();
    const index = this.maps.findIndex((map) => map.id === this.activeMapId);
    if (index < 0) return;
    this.maps.splice(index, 1);
    this.activeMapId = (this.maps[index] || this.maps[index - 1] || this.maps[0]).id;
    this.hideEditor();
    this.actionBarOpen = false;
    this.loadMap(this.currentMap());
    this.save();
    this.syncControls();
    this.render();
    this.animateCanvasSwap();
    this.el.svg.focus();
  };

  Controller.prototype.createMapFromFocusedNode = function () {
    const found = model.findNode(this.store.tree, this.store.focusedId);
    const currentMap = this.currentMap();
    if (!found || found.node.id === model.ROOT_ID || !currentMap) {
      this.updateStatus("Alt+Enter needs child focus");
      return;
    }
    const sourceId = model.sourceIdForViewNode(found.node, currentMap.rootNodeId);
    const existing = this.maps.find((map) => map.rootNodeId === sourceId);
    this.hideEditor();
    this.actionBarOpen = false;
    if (!existing) this.pushUndoSnapshot();
    this.captureActiveMap();
    const map = existing || this.createMap(sourceId, this.mind.nodes[sourceId].label);
    if (!existing) this.maps.push(map);
    this.activeMapId = map.id;
    this.loadMap(map);
    this.save();
    this.syncControls();
    this.render();
    this.animateCanvasSwap();
    this.el.svg.focus();
  };

  Controller.prototype.ensureMapForNode = function (sourceId, excludeMapId) {
    const existing = this.maps.find((map) => map.rootNodeId === sourceId && map.id !== excludeMapId);
    if (existing) return existing;
    const source = this.mind.nodes[sourceId];
    if (!source) return null;
    const map = this.createMap(sourceId, source.label);
    this.maps.push(map);
    return map;
  };

  Controller.prototype.afterTreeChange = function (save, revealFocus) {
    if (save) this.save();
    this.scheduleRender(revealFocus);
  };

  Controller.prototype.startEdit = function (id) {
    const found = model.findNode(this.store.tree, id);
    if (!found) return;
    this.closeNoteSidebar(false);
    model.setFocus(this.store, id);
    this.editingId = id;
    this.actionBarOpen = false;
    this.el.nodeEditor.value = found.node.label;
    this.el.nodeEditor.hidden = false;
    this.scheduleRender(true);
    requestAnimationFrame(() => {
      this.positionEditor();
      this.el.nodeEditor.focus();
      this.el.nodeEditor.select();
    });
  };

  Controller.prototype.finishEdit = function (save) {
    if (!this.editingId) return;
    const id = this.editingId;
    this.editingId = null;
    this.el.nodeEditor.hidden = true;
    if (save) {
      const found = model.findNode(this.store.tree, id);
      const map = this.currentMap();
      const sourceId = found && map ? model.sourceIdForViewNode(found.node, map.rootNodeId) : null;
      const nextLabel = utils.cleanLabel(this.el.nodeEditor.value);
      if (sourceId && nextLabel && this.mind.nodes[sourceId].label !== nextLabel) {
        this.pushUndoSnapshot();
        model.renameMindNode(this.mind, sourceId, nextLabel);
      }
      this.refreshViewTree(id);
    }
    this.afterTreeChange(save, true);
    this.el.svg.focus();
  };

  Controller.prototype.hideEditor = function () {
    this.editingId = null;
    this.el.nodeEditor.hidden = true;
  };

  Controller.prototype.animateCanvasSwap = function () {
    this.el.svg.classList.remove("map-fade");
    void this.el.svg.offsetWidth;
    this.el.svg.classList.add("map-fade");
    setTimeout(() => this.el.svg.classList.remove("map-fade"), 150);
  };

  Controller.prototype.showDeletedNodeGhost = function (node) {
    const point = this.positions.get(node.id);
    if (!point) return;
    const rect = this.renderer.editorRect(node, point, this.viewBox());
    const ghost = document.createElement("div");
    ghost.className = "node-delete-ghost";
    ghost.textContent = node.label;
    ghost.style.left = rect.left + "px";
    ghost.style.top = rect.top + "px";
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    this.el.svg.parentElement.append(ghost);
    setTimeout(() => ghost.remove(), 150);
  };

  Controller.prototype.render = function () {
    const rect = this.el.svg.getBoundingClientRect();
    this.viewport = {
      width: Math.max(config.layout.minViewportWidth, rect.width || config.layout.minViewportWidth),
      height: Math.max(config.layout.minViewportHeight, rect.height || config.layout.minViewportHeight)
    };

    const layout = this.layoutEngine.layout(this.store.tree, this.viewport, this.viewMode, this.spacing);
    this.world = layout.world;
    this.positions = layout.positions;
    if (!this.cameraReady) {
      this.centerCamera();
      this.cameraReady = true;
    }
    this.clampCamera();
    if (this.shouldRevealFocus) this.fitBounds(layout.bounds);
    const viewBox = this.viewBox();
    const animatedFocusId = this.previousRenderedFocusId && this.previousRenderedFocusId !== this.store.focusedId ? this.store.focusedId : null;
    const animatedNewId = this.animatedNewNodeId;

    this.renderer.render({
      tree: this.store.tree,
      nodes: layout.nodes,
      positions: this.positions,
      rings: layout.rings,
      focusedId: this.store.focusedId,
      animatedFocusId,
      animatedNewId,
      focusContext: focusContext(this.store.tree, this.store.focusedId),
      mapRootIds: new Set(this.maps.map((map) => map.rootNodeId)),
      showStatusMarkers: true,
      showPriorityMarkers: true,
      previousPositions: this.layoutAnimationPositions,
      viewBox
    }, {
      focus: (id, event) => this.focusNode(id, event),
      edit: (id) => this.startEdit(id),
      nodePointerDown: (event, id) => this.startNodeDrag(event, id)
    });

    this.updateStatus();
    this.syncNoteSidebar();
    this.positionEditor();
    this.positionActionBar();
    this.shouldRevealFocus = false;
    this.previousRenderedFocusId = this.store.focusedId;
    this.animatedNewNodeId = null;
    this.layoutAnimationPositions = null;
  };

  Controller.prototype.focusNode = function (id, event) {
    this.saveFocusedNote();
    if (!model.setFocus(this.store, id)) return;
    this.hideEditor();
    this.syncNoteSidebar(true);
    this.actionBarOpen = true;
    this.afterTreeChange(false, true);
    if (event && (event.ctrlKey || event.metaKey)) this.openNoteSidebar();
    else this.el.svg.focus();
  };

  Controller.prototype.scheduleRender = function (revealFocus) {
    this.shouldRevealFocus = Boolean(revealFocus || this.shouldRevealFocus);
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  };

  Controller.prototype.syncControls = function () {
    this.syncMapSelect();
    this.el.titleInput.value = this.store.tree.label;
    this.el.viewModeInput.checked = this.viewMode === "ring";
    this.applyTheme();
    this.applyAppearance();
    this.syncThemeControls();
    this.renderBranchPalette();
    this.syncSpacingInputs(true);
    this.syncAppearanceInputs(true);
    this.syncStyleControls();
    this.updateStatus();
  };

  Controller.prototype.syncMapSelect = function () {
    this.maps = this.maps.filter((map) => this.mind.nodes[map.rootNodeId]);
    if (!this.maps.length) this.maps.push(this.createMap(this.mind.rootId, this.mind.nodes[this.mind.rootId].label));
    if (!this.currentMap()) this.activeMapId = this.maps[0].id;
    this.el.mapSelect.replaceChildren();
    this.maps.forEach((map) => {
      const option = document.createElement("option");
      option.value = map.id;
      option.textContent = this.mind.nodes[map.rootNodeId]?.label || map.title || "Chart Title";
      this.el.mapSelect.append(option);
    });
    this.el.mapSelect.value = this.activeMapId;
    this.el.deleteMapButton.disabled = this.maps.length <= 1;
  };

  Controller.prototype.syncSpacingInputs = function (force) {
    Object.entries(this.el.spacingInputs).forEach(([key, input]) => {
      if (!force && document.activeElement === input) return;
      input.value = String(this.spacing[key]);
    });
  };

  Controller.prototype.syncAppearanceInputs = function (force) {
    Object.entries(this.el.appearanceInputs).forEach(([key, input]) => {
      if (!force && document.activeElement === input) return;
      input.value = String(this.appearance[key]);
    });
    Object.entries(this.el.appearanceToggles || {}).forEach(([key, input]) => {
      if (!input) return;
      input.checked = this.appearance[key] !== false;
    });
  };

  Controller.prototype.updateStatus = function (message) {
    const found = model.findNode(this.store.tree, this.store.focusedId);
    if (!found) return;
    const node = found.node;
    const depthNames = ["title", "primary", "secondary", "leaf"];
    const canAdd = node.depth < config.limits.maxDepth && node.children.length < config.limits.maxChildren;
    if (document.activeElement !== this.el.titleInput) this.el.titleInput.value = this.store.tree.label;
    if (document.activeElement !== this.el.nodeLabelInput) this.el.nodeLabelInput.value = node.label;
    this.el.viewModeInput.checked = this.viewMode === "ring";
    this.syncThemeControls();
    this.syncSpacingInputs(false);
    this.syncAppearanceInputs(false);
    this.syncStyleControls();
    this.el.addButton.disabled = !canAdd;
    this.el.deleteButton.disabled = node.id === model.ROOT_ID;
    this.el.openMapButton.disabled = node.id === model.ROOT_ID;
    this.el.reparentButton.disabled = node.id === model.ROOT_ID && this.currentMap()?.rootNodeId === this.mind.rootId;
    this.el.noteButton.disabled = false;
    this.syncMapSelect();
    this.updatePathTrail();
    this.el.statusText.textContent = message || `${depthNames[node.depth]} focus | ${node.children.length}/12 children${canAdd ? "" : " | max reached"}`;
  };

  Controller.prototype.updatePathTrail = function () {
    if (!this.el.pathTrail) return;
    const map = this.currentMap();
    this.el.pathTrail.replaceChildren();
    if (!map) return;
    const items = mindPathItems(this.mind, map.rootNodeId);
    items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => this.openPathSource(item.id));
      this.el.pathTrail.append(button);
      if (index < items.length - 1) {
        const divider = document.createElement("span");
        divider.textContent = "/";
        this.el.pathTrail.append(divider);
      }
    });
  };

  Controller.prototype.save = function () {
    this.captureActiveMap();
    const saved = storage.save({
      mind: this.mind,
      maps: this.maps,
      activeMapId: this.activeMapId,
      appearance: this.appearance,
      theme: this.theme,
      customTheme: this.customTheme,
      branchColors: this.branchColors
    });
    this.markSaved(saved);
  };

  Controller.prototype.applyTheme = function () {
    const preset = config.themePresets[this.theme] || config.themePresets.light;
    const tokens = this.theme === "custom" ? Object.assign({}, preset.tokens, this.customTheme) : preset.tokens;
    const colorScheme = this.theme === "custom" ? inferColorScheme(tokens.bg) : preset.colorScheme;
    document.documentElement.dataset.theme = colorScheme === "dark" ? "dark" : "light";
    document.documentElement.style.colorScheme = colorScheme;
    MANAGED_THEME_TOKEN_KEYS.forEach((key) => {
      document.documentElement.style.removeProperty("--" + key);
    });
    Object.entries(tokens).forEach(([key, value]) => {
      document.documentElement.style.setProperty("--" + key, value);
    });
    config.colors = storage.normalizeBranchColors(this.branchColors);
  };

  Controller.prototype.applyAppearance = function () {
    document.documentElement.style.setProperty("--node-font-size", this.appearance.nodeFontSize + "px");
    document.documentElement.style.setProperty("--leaf-marker-font-size", Math.max(7, Math.round(this.appearance.nodeFontSize * 0.69)) + "px");
    document.documentElement.dataset.style = storage.normalizeStylePreset(this.appearance.stylePreset);
    this.applyStyleOverrides();
  };

  Controller.prototype.applyStyleOverrides = function () {
    const style = storage.normalizeStylePreset(this.appearance.stylePreset);
    const tokens = styleTokens(style, document.documentElement.dataset.theme === "dark");
    if (!tokens) {
      MANAGED_STYLE_TOKEN_KEYS
        .filter((key) => !MANAGED_THEME_TOKEN_KEYS.includes(key))
        .forEach((key) => {
          document.documentElement.style.removeProperty("--" + key);
        });
      return;
    }
    MANAGED_STYLE_TOKEN_KEYS.forEach((key) => {
      document.documentElement.style.removeProperty("--" + key);
    });
    Object.entries(tokens).forEach(([key, value]) => {
      document.documentElement.style.setProperty("--" + key, value);
    });
  };

  Controller.prototype.syncStyleControls = function () {
    if (this.el.stylePresetInput && !this.el.stylePresetInput.options.length) {
      Object.entries(config.stylePresets).forEach(([key, preset]) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = preset.label;
        this.el.stylePresetInput.append(option);
      });
    }
    if (this.el.navigationModeInput && !this.el.navigationModeInput.options.length) {
      Object.entries(config.navigationModes).forEach(([key, preset]) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = preset.label;
        this.el.navigationModeInput.append(option);
      });
    }
    if (this.el.stylePresetInput) this.el.stylePresetInput.value = storage.normalizeStylePreset(this.appearance.stylePreset);
    if (this.el.navigationModeInput) this.el.navigationModeInput.value = storage.normalizeNavigationMode(this.appearance.navigationMode);
  };

  Controller.prototype.syncThemeControls = function () {
    if (!this.el.themePresetInput) return;
    if (!this.el.themePresetInput.options.length) {
      Object.entries(config.themePresets).forEach(([key, preset]) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = preset.label;
        this.el.themePresetInput.append(option);
      });
    }
    this.el.themePresetInput.value = config.themePresets[this.theme] ? this.theme : "light";
    if (this.el.customThemeEditor) this.el.customThemeEditor.hidden = this.theme !== "custom";
    if (!this.el.customThemeEditor || !this.el.customThemeEditor.contains(document.activeElement)) this.renderCustomThemeEditor();
  };

  Controller.prototype.renderCustomThemeEditor = function () {
    if (!this.el.customThemeEditor) return;
    this.el.customThemeEditor.replaceChildren();
    config.themeTokenControls.forEach((control) => {
      const label = document.createElement("label");
      const name = document.createElement("span");
      name.textContent = control.label;
      const input = document.createElement("input");
      input.type = "color";
      input.value = this.customTheme[control.key] || config.themePresets.custom.tokens[control.key] || "#000000";
      input.addEventListener("input", () => {
        if (document.activeElement !== input) return;
        this.theme = "custom";
        this.customTheme[control.key] = input.value;
        this.customTheme = storage.normalizeCustomTheme(this.customTheme);
        this.applyTheme();
        this.save();
        this.syncThemeControls();
      });
      label.append(name, input);
      this.el.customThemeEditor.append(label);
    });
  };

  Controller.prototype.renderBranchPalette = function () {
    if (!this.el.branchPalette) return;
    this.el.branchPalette.replaceChildren();
    this.branchColors.forEach((color, index) => {
      const input = document.createElement("input");
      input.type = "color";
      input.value = color;
      input.title = "Branch " + (index + 1);
      input.setAttribute("aria-label", "Branch " + (index + 1) + " color");
      input.addEventListener("input", () => {
        this.branchColors[index] = input.value;
        this.applyTheme();
        this.save();
        this.scheduleRender(false);
      });
      this.el.branchPalette.append(input);
    });
  };

  Controller.prototype.shuffleBranchPalette = function () {
    const odd = this.branchColors.filter((_, index) => index % 2 === 0);
    const even = this.branchColors.filter((_, index) => index % 2 === 1);
    this.branchColors = odd.concat(even);
    this.applyTheme();
    this.save();
    this.renderBranchPalette();
    this.scheduleRender(false);
    this.updateStatus("Branch palette shuffled");
  };

  Controller.prototype.resetBranchPalette = function () {
    this.branchColors = DEFAULT_BRANCH_COLORS.slice();
    this.applyTheme();
    this.save();
    this.renderBranchPalette();
    this.scheduleRender(false);
    this.updateStatus("Branch palette reset");
  };

  Controller.prototype.openNoteSidebar = function () {
    if (this.editingId) this.finishEdit(true);
    const node = this.currentMindNode();
    if (!node) {
      this.updateStatus("No node selected");
      return;
    }
    clearTimeout(this.noteCloseTimer);
    this.el.noteSidebar.classList.remove("is-closing");
    this.el.noteSidebar.hidden = false;
    this.syncNoteSidebar();
    requestAnimationFrame(() => this.el.noteInput.focus());
  };

  Controller.prototype.toggleNoteSidebar = function () {
    if (this.el.noteSidebar && !this.el.noteSidebar.hidden && !this.el.noteSidebar.classList.contains("is-closing")) {
      this.closeNoteSidebar();
      return;
    }
    this.openNoteSidebar();
  };

  Controller.prototype.closeNoteSidebar = function (focusCanvas) {
    if (!this.el.noteSidebar || this.el.noteSidebar.hidden) return;
    this.saveFocusedNote();
    this.closeNodeLinkSuggest();
    this.el.noteSidebar.classList.add("is-closing");
    clearTimeout(this.noteCloseTimer);
    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.noteCloseTimer = setTimeout(() => {
      this.el.noteSidebar.hidden = true;
      this.el.noteSidebar.classList.remove("is-closing");
    }, reducedMotion ? 1 : 130);
    if (focusCanvas !== false) this.el.svg.focus();
  };

  Controller.prototype.syncNoteSidebar = function (forceNoteInput) {
    if (!this.el.noteSidebar || this.el.noteSidebar.hidden) return;
    const node = this.currentMindNode();
    if (!node) {
      this.el.noteSidebar.hidden = true;
      return;
    }
    this.el.noteSidebarTitle.textContent = node.label;
    if (this.el.nodeStatusInput) this.el.nodeStatusInput.value = node.status || "open";
    if (this.el.nodePriorityInput) this.el.nodePriorityInput.value = node.priority || "normal";
    if (this.el.nodeMarkerInput) this.el.nodeMarkerInput.checked = node.markerEnabled === true;
    if (this.el.nodeTagsInput && document.activeElement !== this.el.nodeTagsInput) {
      this.el.nodeTagsInput.value = Array.isArray(node.tags) ? node.tags.join(", ") : "";
    }
    if (forceNoteInput || document.activeElement !== this.el.noteInput) this.el.noteInput.value = node.note || "";
    this.renderNoteLinks(node.note || "");
    this.renderBacklinks();
    this.renderNodeLinkSuggest();
  };

  Controller.prototype.saveFocusedNote = function () {
    if (!this.el.noteInput || this.el.noteSidebar.hidden) return;
    const sourceId = this.focusedSourceId();
    if (!sourceId) return;
    model.updateMindNodeNote(this.mind, sourceId, this.el.noteInput.value);
    model.updateMindNodeMeta(this.mind, sourceId, {
      status: this.el.nodeStatusInput ? this.el.nodeStatusInput.value : "open",
      priority: this.el.nodePriorityInput ? this.el.nodePriorityInput.value : "normal",
      markerEnabled: this.el.nodeMarkerInput ? this.el.nodeMarkerInput.checked : false,
      tags: this.el.nodeTagsInput ? this.el.nodeTagsInput.value : []
    });
    this.refreshViewTree(this.store.focusedId);
    this.save();
    this.renderNoteLinks(this.el.noteInput.value);
    this.renderBacklinks();
    this.scheduleRender(false);
  };

  Controller.prototype.focusNoteSourceNode = function () {
    if (!this.currentMindNode()) return;
    this.closeNoteSidebar(false);
    this.actionBarOpen = true;
    this.el.svg.focus();
    this.afterTreeChange(false, true);
    this.updateStatus("Node focused");
  };

  Controller.prototype.renderNoteLinks = function (note) {
    if (!this.el.noteLinks) return;
    this.el.noteLinks.replaceChildren();
    const items = noteLinkItems(note, this.mind);
    this.el.noteLinks.hidden = !items.length;
    items.forEach((item) => {
      if (item.kind === "url") {
        const link = document.createElement("a");
        link.href = item.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = item.label;
        this.el.noteLinks.append(link);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => {
        this.closeNoteSidebar(false);
        this.focusSourceId(item.sourceId);
      });
      this.el.noteLinks.append(button);
    });
  };

  Controller.prototype.renderBacklinks = function () {
    if (!this.el.backlinks) return;
    this.el.backlinks.replaceChildren();
    const sourceId = this.focusedSourceId();
    const node = sourceId ? this.mind.nodes[sourceId] : null;
    if (!node) {
      this.el.backlinks.hidden = true;
      return;
    }
    const items = backlinkItems(this.mind, node).slice(0, 8);
    this.el.backlinks.hidden = !items.length;
    if (!items.length) return;
    const heading = document.createElement("span");
    heading.className = "backlinks-title";
    heading.textContent = "Linked from";
    this.el.backlinks.append(heading);
    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => {
        this.closeNoteSidebar(false);
        this.focusSourceId(item.sourceId);
      });
      this.el.backlinks.append(button);
    });
  };

  Controller.prototype.renderNodeLinkSuggest = function () {
    if (!this.el.nodeLinkSuggest || document.activeElement !== this.el.noteInput) {
      this.closeNodeLinkSuggest();
      return;
    }
    const range = activeNodeLinkRange(this.el.noteInput);
    if (!range) {
      this.closeNodeLinkSuggest();
      return;
    }
    const query = range.query.toLowerCase();
    this.nodeLinkItems = Object.values(this.mind.nodes)
      .filter((node) => node.label && node.label.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStarts = a.label.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.label.toLowerCase().startsWith(query) ? 0 : 1;
        return aStarts - bStarts || a.label.localeCompare(b.label);
      })
      .slice(0, 8);
    this.nodeLinkRange = range;
    this.nodeLinkIndex = Math.min(this.nodeLinkIndex, Math.max(0, this.nodeLinkItems.length - 1));
    this.el.nodeLinkSuggest.replaceChildren();
    this.el.nodeLinkSuggest.hidden = !this.nodeLinkItems.length;
    this.nodeLinkItems.forEach((node, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", index === this.nodeLinkIndex ? "true" : "false");
      button.className = index === this.nodeLinkIndex ? "active" : "";
      button.textContent = node.label;
      button.addEventListener("mouseenter", () => {
        this.nodeLinkIndex = index;
        this.syncNodeLinkSuggestActive();
      });
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.insertNodeLink(node);
      });
      this.el.nodeLinkSuggest.append(button);
    });
  };

  Controller.prototype.handleNodeLinkSuggestKey = function (event) {
    if (!this.el.nodeLinkSuggest || this.el.nodeLinkSuggest.hidden) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.nodeLinkIndex = Math.min(this.nodeLinkItems.length - 1, this.nodeLinkIndex + 1);
      this.syncNodeLinkSuggestActive();
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.nodeLinkIndex = Math.max(0, this.nodeLinkIndex - 1);
      this.syncNodeLinkSuggestActive();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const item = this.nodeLinkItems[this.nodeLinkIndex];
      if (!item) return false;
      event.preventDefault();
      this.insertNodeLink(item);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeNodeLinkSuggest();
      return true;
    }
    return false;
  };

  Controller.prototype.syncNodeLinkSuggestActive = function () {
    Array.from(this.el.nodeLinkSuggest.children).forEach((child, index) => {
      const active = index === this.nodeLinkIndex;
      child.classList.toggle("active", active);
      child.setAttribute("aria-selected", active ? "true" : "false");
    });
  };

  Controller.prototype.insertNodeLink = function (node) {
    const range = this.nodeLinkRange || activeNodeLinkRange(this.el.noteInput);
    if (!range) return;
    const value = this.el.noteInput.value;
    const replacement = "[[" + node.label + "]]";
    this.el.noteInput.value = value.slice(0, range.start) + replacement + value.slice(range.end);
    const cursor = range.start + replacement.length;
    this.el.noteInput.setSelectionRange(cursor, cursor);
    this.closeNodeLinkSuggest();
    this.saveFocusedNote();
    this.el.noteInput.focus();
  };

  Controller.prototype.closeNodeLinkSuggest = function () {
    this.nodeLinkItems = [];
    this.nodeLinkIndex = 0;
    this.nodeLinkRange = null;
    if (!this.el.nodeLinkSuggest) return;
    this.el.nodeLinkSuggest.hidden = true;
    this.el.nodeLinkSuggest.replaceChildren();
  };

  Controller.prototype.focusedSourceId = function () {
    const found = model.findNode(this.store.tree, this.store.focusedId);
    const map = this.currentMap();
    return found && map ? model.sourceIdForViewNode(found.node, map.rootNodeId) : null;
  };

  Controller.prototype.currentMindNode = function () {
    const sourceId = this.focusedSourceId();
    return sourceId ? this.mind.nodes[sourceId] : null;
  };

  Controller.prototype.openPathSource = function (sourceId) {
    const existing = this.maps.find((map) => map.rootNodeId === sourceId);
    const map = existing || this.ensureMapForNode(sourceId);
    if (!map) return;
    this.openMap(map);
  };

  Controller.prototype.pushUndoSnapshot = function () {
    this.captureActiveMap();
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  };

  Controller.prototype.snapshot = function () {
    return JSON.stringify({
      mind: this.mind,
      maps: this.maps,
      activeMapId: this.activeMapId,
      downMapStack: this.downMapStack,
      appearance: this.appearance,
      theme: this.theme,
      customTheme: this.customTheme,
      branchColors: this.branchColors
    });
  };

  Controller.prototype.restoreSnapshot = function (raw) {
    const snapshot = JSON.parse(raw);
    this.mind = snapshot.mind;
    this.maps = snapshot.maps;
    this.activeMapId = snapshot.activeMapId;
    this.downMapStack = Array.isArray(snapshot.downMapStack) ? snapshot.downMapStack : [];
    this.appearance = storage.normalizeAppearance(snapshot.appearance, config.appearanceDefaults);
    this.theme = storage.normalizeTheme(snapshot.theme);
    this.customTheme = storage.normalizeCustomTheme(snapshot.customTheme);
    this.branchColors = storage.normalizeBranchColors(snapshot.branchColors);
    this.hideEditor();
    this.closeNoteSidebar(false);
    this.actionBarOpen = false;
    this.loadMap(this.currentMap());
    this.save();
    this.syncControls();
    this.render();
    this.el.svg.focus();
  };

  Controller.prototype.undo = function () {
    if (!this.undoStack.length) {
      this.updateStatus("Nothing to undo");
      return;
    }
    this.captureActiveMap();
    this.redoStack.push(this.snapshot());
    this.restoreSnapshot(this.undoStack.pop());
    this.updateStatus("Undone");
  };

  Controller.prototype.redo = function () {
    if (!this.redoStack.length) {
      this.updateStatus("Nothing to redo");
      return;
    }
    this.captureActiveMap();
    this.undoStack.push(this.snapshot());
    this.restoreSnapshot(this.redoStack.pop());
    this.updateStatus("Redone");
  };

  Controller.prototype.openCommandPalette = function () {
    this.el.commandPalette.hidden = false;
    this.el.commandInput.value = "";
    this.paletteIndex = 0;
    this.renderCommandResults();
    requestAnimationFrame(() => this.el.commandInput.focus());
  };

  Controller.prototype.closeCommandPalette = function () {
    this.el.commandPalette.hidden = true;
    this.el.svg.focus();
  };

  Controller.prototype.showWelcomeIfNeeded = function () {
    if (!this.el.welcomeDialog) return;
    let seen = false;
    try {
      seen = localStorage.getItem(WELCOME_KEY) === "seen";
    } catch (error) {
      seen = true;
    }
    if (seen) return;
    this.openWelcome();
  };

  Controller.prototype.openWelcome = function () {
    if (!this.el.welcomeDialog) return;
    this.renderWelcome();
    this.el.welcomeDialog.hidden = false;
    requestAnimationFrame(() => {
      if (this.el.welcomeCloseButton) this.el.welcomeCloseButton.focus();
    });
  };

  Controller.prototype.closeWelcome = function () {
    if (!this.el.welcomeDialog) return;
    this.el.welcomeDialog.hidden = true;
    try {
      localStorage.setItem(WELCOME_KEY, "seen");
    } catch (error) {
      return;
    }
    this.el.svg.focus();
  };

  Controller.prototype.renderWelcome = function () {
    if (this.el.welcomeStats) {
      const nodeCount = Object.keys(this.mind.nodes).length;
      this.el.welcomeStats.textContent = `${nodeCount} nodes · ${this.maps.length} maps · autosaved`;
    }
    if (!this.el.welcomeRecent) return;
    this.el.welcomeRecent.replaceChildren();
    if (!this.recentMinds.length) {
      const empty = document.createElement("span");
      empty.textContent = "No recent minds yet";
      this.el.welcomeRecent.append(empty);
      return;
    }
    this.recentMinds.slice(0, 3).forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => {
        this.closeWelcome();
        this.openRecentMind(item.id);
      });
      this.el.welcomeRecent.append(button);
    });
  };

  Controller.prototype.applyWelcomeStyle = function (style) {
    this.appearance.stylePreset = storage.normalizeStylePreset(style);
    this.applyAppearance();
    this.save();
    this.syncControls();
    this.renderWelcome();
    this.updateStatus(`Style: ${config.stylePresets[this.appearance.stylePreset].label}`);
  };

  Controller.prototype.applyWelcomeTemplate = function (template, options) {
    const tree = welcomeTemplateTree(template);
    if (!tree) return false;
    const hasWork = Object.keys(this.mind.nodes).length > 1 || this.currentMindNode()?.label !== "Chart Title";
    if (hasWork && !confirm("Replace current mind with this starter template?")) return false;
    this.pushUndoSnapshot();
    this.store = model.createStore(model.cloneAsRoot(tree));
    this.mind = model.createMindFromTree(this.store.tree);
    this.maps = [this.createMap(model.ROOT_ID, this.store.tree.label)];
    this.activeMapId = this.maps[0].id;
    this.downMapStack = [];
    this.hideEditor();
    this.closeNoteSidebar(false);
    this.actionBarOpen = false;
    this.cameraReady = false;
    this.loadMap(this.currentMap());
    this.save();
    this.syncControls();
    this.render();
    this.renderWelcome();
    if (options && options.closeWelcome) this.closeWelcome();
    this.updateStatus("Template loaded");
    return true;
  };

  Controller.prototype.startTutorial = function () {
    if (!this.applyWelcomeTemplate("tutorial", { closeWelcome: true })) return;
    this.createTutorialChapterMaps();
    this.updateStatus("Tutorial loaded. Ctrl+click root node to begin.");
  };

  Controller.prototype.createTutorialChapterMaps = function () {
    Object.values(this.mind.nodes)
      .filter((node) => /^Chapter \d+:/.test(node.label) || /^\d+\./.test(node.label))
      .forEach((node) => {
        if (!this.maps.some((map) => map.rootNodeId === node.id)) this.maps.push(this.createMap(node.id, node.label));
      });
    this.save();
    this.syncControls();
  };

  Controller.prototype.handleCommandKey = function (event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeCommandPalette();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this.paletteIndex = Math.min(this.paletteItems.length - 1, this.paletteIndex + 1);
      this.renderCommandResults();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.paletteIndex = Math.max(0, this.paletteIndex - 1);
      this.renderCommandResults();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = this.paletteItems[this.paletteIndex];
      if (item) this.runCommandItem(item);
    }
  };

  Controller.prototype.renderCommandResults = function () {
    const query = this.el.commandInput.value.trim().toLowerCase();
    this.paletteItems = this.commandItems(query).slice(0, 12);
    this.paletteIndex = Math.min(this.paletteIndex, Math.max(0, this.paletteItems.length - 1));
    this.el.commandResults.replaceChildren();
    this.paletteItems.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === this.paletteIndex ? "active" : "";
      button.setAttribute("aria-current", index === this.paletteIndex ? "true" : "false");
      const title = document.createElement("span");
      title.textContent = item.title;
      const detail = document.createElement("small");
      detail.textContent = item.detail;
      button.append(title, detail);
      button.addEventListener("mouseenter", () => {
        this.paletteIndex = index;
        Array.from(this.el.commandResults.children).forEach((child, childIndex) => {
          if (!child.classList) return;
          const active = childIndex === index;
          child.classList.toggle("active", active);
          child.setAttribute("aria-current", active ? "true" : "false");
        });
      });
      button.addEventListener("click", () => this.runCommandItem(item));
      this.el.commandResults.append(button);
    });
    if (!this.paletteItems.length) {
      const empty = document.createElement("p");
      empty.textContent = "No results";
      this.el.commandResults.append(empty);
    }
  };

  Controller.prototype.commandItems = function (query) {
    const focusedNode = this.currentMindNode();
    const commands = [
      { kind: "command", title: "Add child", detail: "Enter", run: () => this.addNode(true) },
      { kind: "command", title: "Show welcome", detail: "Templates, recents, shortcuts", run: () => this.openWelcome() },
      { kind: "command", title: "Find node", detail: "Type any node, note, tag, status, or priority", run: () => this.updateStatus("Type to search nodes and notes") },
      { kind: "command", title: "Move focus", detail: "Arrows, WASD, HJKL", run: () => this.updateStatus("Move focus: arrows, WASD, or HJKL") },
      { kind: "command", title: "Tree movement", detail: "Shift+Arrow", run: () => this.updateStatus("Tree movement: Shift+Arrow") },
      { kind: "command", title: "Pan canvas", detail: "Space+drag or wheel", run: () => this.updateStatus("Pan: Space+drag or wheel") },
      { kind: "command", title: "Edit label", detail: "Shift+Enter", run: () => this.startEdit(this.store.focusedId) },
      { kind: "command", title: "Delete focused node", detail: "Delete or Backspace", run: () => this.deleteFocused() },
      { kind: "command", title: "Parent or child map", detail: "Ctrl+Left / Ctrl+Right", run: () => this.updateStatus("Map nav: Ctrl+Left parent, Ctrl+Right child") },
      { kind: "command", title: "New mind", detail: "Blank document", run: () => this.newMind() },
      { kind: "command", title: "Save mind", detail: "Local autosave", run: () => this.save() },
      { kind: "command", title: "Save copy", detail: ".mind.json", run: () => this.exportMind() },
      { kind: "command", title: "Clear recents", detail: "Remove stored snapshots", run: () => this.clearRecentMinds() },
      { kind: "command", title: "Export theme", detail: ".concen-theme.json", run: () => this.exportTheme() },
      { kind: "command", title: "Toggle notes", detail: "Ctrl+Enter or Ctrl+click", run: () => this.toggleNoteSidebar() },
      { kind: "command", title: focusedNode && focusedNode.markerEnabled ? "Hide marker" : "Show marker", detail: "Focused node", run: () => this.setFocusedMarker(!(focusedNode && focusedNode.markerEnabled)) },
      { kind: "command", title: "Open node map", detail: "Alt+Enter", run: () => this.createMapFromFocusedNode() },
      { kind: "command", title: "Create parent", detail: "Ctrl+Shift+Enter", run: () => this.createParentForFocusedNode() },
      { kind: "command", title: "Toggle light/dark", detail: "Theme", run: () => this.toggleTheme() },
      { kind: "command", title: "Next style", detail: "Style theme", run: () => this.cycleStylePreset() },
      { kind: "command", title: "Next navigation mode", detail: "Arrow policy", run: () => this.cycleNavigationMode() },
      { kind: "command", title: "Toggle grouped view", detail: "Layout", run: () => this.toggleViewMode() },
      { kind: "command", title: "Undo", detail: "Ctrl+Z", run: () => this.undo() },
      { kind: "command", title: "Redo", detail: "Ctrl+Shift+Z", run: () => this.redo() }
    ];
    ["open", "active", "waiting", "done"].forEach((status) => {
      commands.push({
        kind: "command",
        title: "Set status: " + titleCase(status),
        detail: "Focused node",
        text: ("status " + status + " set focused node").toLowerCase(),
        run: () => this.setFocusedStatus(status)
      });
    });
    ["low", "normal", "high", "critical"].forEach((priority) => {
      commands.push({
        kind: "command",
        title: "Set priority: " + titleCase(priority),
        detail: "Focused node",
        text: ("priority " + priority + " set focused node").toLowerCase(),
        run: () => this.setFocusedPriority(priority)
      });
    });
    const recent = this.recentMinds.map((item) => ({
      kind: "recent",
      title: item.label,
      detail: "Recent mind",
      recentId: item.id,
      text: `${item.label} recent mind`.toLowerCase()
    }));
    const nodes = Object.values(this.mind.nodes).map((node) => ({
      kind: "node",
      title: node.label,
      detail: nodeSearchDetail(this.mind, node),
      sourceId: node.id,
      text: `${node.label} ${node.note || ""} ${node.status || ""} ${node.priority || ""} ${(node.tags || []).join(" ")}`.toLowerCase()
    }));
    const linkedNodes = focusedNode ? noteLinkItems(focusedNode.note || "", this.mind)
      .filter((item) => item.kind === "node")
      .map((item) => ({
        kind: "node",
        title: "Open linked node: " + item.label.replace(/^Node:\s*/, ""),
        detail: "From focused note",
        sourceId: item.sourceId,
        text: ("open linked node link " + item.label).toLowerCase()
      })) : [];
    const moveTargets = this.moveTargetItems(query);
    const all = commands.concat(moveTargets, linkedNodes, recent, nodes);
    if (!query) return all;
    return all.filter((item) => (item.text || `${item.title} ${item.detail}`.toLowerCase()).includes(query));
  };

  Controller.prototype.runCommandItem = function (item) {
    this.closeCommandPalette();
    if (item.kind === "node") this.focusSourceId(item.sourceId);
    else if (item.kind === "move-target") this.moveFocusedTo(item.sourceId);
    else if (item.kind === "recent") this.openRecentMind(item.recentId);
    else item.run();
  };

  Controller.prototype.moveTargetItems = function (query) {
    if (!/\b(move|reparent|under|to)\b/.test(query)) return [];
    const sourceId = this.focusedSourceId();
    if (!sourceId) return [];
    const map = this.currentMap();
    if (!map) return [];
    return model.visibleNodes(this.store.tree)
      .map(({ node }) => this.mind.nodes[model.sourceIdForViewNode(node, map.rootNodeId)])
      .filter(Boolean)
      .filter((node) => node.id !== sourceId && node.id !== this.mind.rootId)
      .filter((node) => this.validateNodeDrop(sourceId, node.id).ok)
      .map((node) => ({
        kind: "move-target",
        title: "Move under: " + node.label,
        detail: nodeSearchDetail(this.mind, node),
        sourceId: node.id,
        text: `move reparent under to ${node.label} ${node.note || ""}`.toLowerCase()
      }));
  };

  Controller.prototype.setFocusedStatus = function (status) {
    const sourceId = this.focusedSourceId();
    const node = sourceId ? this.mind.nodes[sourceId] : null;
    if (!node) return;
    this.pushUndoSnapshot();
    model.updateMindNodeMeta(this.mind, sourceId, {
      status,
      priority: node.priority,
      markerEnabled: node.markerEnabled,
      tags: node.tags
    });
    this.refreshViewTree(this.store.focusedId);
    this.syncNoteSidebar(true);
    this.afterTreeChange(true, false);
    this.updateStatus("Status set: " + titleCase(status));
  };

  Controller.prototype.setFocusedPriority = function (priority) {
    const sourceId = this.focusedSourceId();
    const node = sourceId ? this.mind.nodes[sourceId] : null;
    if (!node) return;
    this.pushUndoSnapshot();
    model.updateMindNodeMeta(this.mind, sourceId, {
      status: node.status,
      priority,
      markerEnabled: node.markerEnabled,
      tags: node.tags
    });
    this.refreshViewTree(this.store.focusedId);
    this.syncNoteSidebar(true);
    this.afterTreeChange(true, false);
    this.updateStatus("Priority set: " + titleCase(priority));
  };

  Controller.prototype.setFocusedMarker = function (markerEnabled) {
    const sourceId = this.focusedSourceId();
    const node = sourceId ? this.mind.nodes[sourceId] : null;
    if (!node) return;
    this.pushUndoSnapshot();
    model.updateMindNodeMeta(this.mind, sourceId, {
      status: node.status,
      priority: node.priority,
      markerEnabled,
      tags: node.tags
    });
    this.refreshViewTree(this.store.focusedId);
    this.syncNoteSidebar(true);
    this.afterTreeChange(true, false);
    this.updateStatus(markerEnabled ? "Marker shown" : "Marker hidden");
  };

  Controller.prototype.moveFocusedTo = function (targetId) {
    const sourceId = this.focusedSourceId();
    if (!sourceId) return;
    const validation = this.validateNodeDrop(sourceId, targetId);
    if (!validation.ok) {
      this.updateStatus(validation.message);
      return;
    }
    this.pushUndoSnapshot();
    this.layoutAnimationPositions = new Map(this.positions);
    if (!model.reparentMindNode(this.mind, sourceId, targetId)) {
      this.updateStatus("Cannot move node");
      return;
    }
    this.refreshViewTree(sourceId);
    this.afterTreeChange(true, true);
    this.updateStatus("Node moved");
  };

  Controller.prototype.toggleTheme = function () {
    this.theme = this.theme === "dark" ? "light" : "dark";
    this.applyTheme();
    this.save();
    this.syncControls();
  };

  Controller.prototype.toggleViewMode = function () {
    this.viewMode = this.viewMode === "ring" ? "tree" : "ring";
    this.save();
    this.syncControls();
    this.scheduleRender(true);
  };

  Controller.prototype.cycleStylePreset = function () {
    const keys = Object.keys(config.stylePresets);
    const index = keys.indexOf(storage.normalizeStylePreset(this.appearance.stylePreset));
    this.appearance.stylePreset = keys[(index + 1) % keys.length];
    this.applyAppearance();
    this.save();
    this.syncControls();
    this.updateStatus(`Style: ${config.stylePresets[this.appearance.stylePreset].label}`);
  };

  Controller.prototype.cycleNavigationMode = function () {
    const keys = Object.keys(config.navigationModes);
    const index = keys.indexOf(storage.normalizeNavigationMode(this.appearance.navigationMode));
    this.appearance.navigationMode = keys[(index + 1) % keys.length];
    this.save();
    this.syncControls();
    this.updateStatus(`Navigation: ${config.navigationModes[this.appearance.navigationMode].label}`);
  };

  Controller.prototype.focusSourceId = function (sourceId) {
    this.saveFocusedNote();
    const visible = model.visibleNodes(this.store.tree).find(({ node }) => model.sourceIdForViewNode(node, this.currentMap().rootNodeId) === sourceId);
    if (visible) {
      model.setFocus(this.store, visible.node.id);
      this.syncNoteSidebar(true);
      this.actionBarOpen = false;
      this.afterTreeChange(false, true);
      this.el.svg.focus();
      return;
    }
    const map = this.maps.find((item) => item.rootNodeId === sourceId) || this.ensureMapForNode(sourceId);
    if (!map) return;
    this.openMap(map);
  };

  Controller.prototype.markSaved = function (saved) {
    if (!this.el.saveState) return;
    this.el.saveState.textContent = saved ? "Autosaved" : "Save failed";
    this.el.saveState.dataset.state = saved ? "saved" : "failed";
    clearTimeout(this.saveStateTimer);
    if (saved) {
      this.el.saveState.dataset.state = "saving";
      this.el.saveState.textContent = "Saving";
      this.saveStateTimer = setTimeout(() => {
        this.el.saveState.dataset.state = "saved";
        this.el.saveState.textContent = "Autosaved";
      }, 280);
    }
  };

  Controller.prototype.exportTheme = function () {
    const preset = config.themePresets[this.theme] || config.themePresets.light;
    const payload = {
      type: "concen-theme",
      version: 1,
      exportedAt: new Date().toISOString(),
      name: preset.label,
      theme: this.theme,
      stylePreset: this.appearance.stylePreset,
      customTheme: this.customTheme,
      branchColors: this.branchColors
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = themeFilename(payload.name);
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this.updateStatus("Theme exported");
  };

  Controller.prototype.importTheme = function () {
    const file = this.el.importThemeInput.files && this.el.importThemeInput.files[0];
    if (!file) return;
    if (file.size > config.limits.maxStoredBytes) {
      this.el.importThemeInput.value = "";
      this.updateStatus("Theme file too large");
      return;
    }
    file.text().then((raw) => {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.type && parsed.type !== "concen-theme") throw new Error("Invalid theme file");
        this.theme = storage.normalizeTheme(parsed.theme || "custom");
        this.appearance.stylePreset = storage.normalizeStylePreset(parsed.stylePreset || this.appearance.stylePreset);
        this.customTheme = storage.normalizeCustomTheme(parsed.customTheme || parsed.tokens);
        this.branchColors = storage.normalizeBranchColors(parsed.branchColors);
        this.applyTheme();
        this.save();
        this.syncControls();
        this.render();
        this.updateStatus("Theme imported");
      } catch (error) {
        this.updateStatus("Theme import failed");
      } finally {
        this.el.importThemeInput.value = "";
      }
    });
  };

  Controller.prototype.exportMind = function () {
    this.captureActiveMap();
    const payload = {
      type: "concen-mind",
      version: 1,
      exportedAt: new Date().toISOString(),
      mind: this.mind,
      maps: this.maps,
      activeMapId: this.activeMapId,
      appearance: this.appearance,
      theme: this.theme,
      customTheme: this.customTheme,
      branchColors: this.branchColors
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = mindFilename(this.mind.nodes[this.mind.rootId]?.label || "mind");
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this.updateStatus("Mind copy saved");
  };

  Controller.prototype.importMind = function () {
    const file = this.el.importMindInput.files && this.el.importMindInput.files[0];
    if (!file) return;
    if (file.size > config.limits.maxStoredBytes) {
      this.el.importMindInput.value = "";
      this.updateStatus("Mind file too large");
      return;
    }
    file.text().then((raw) => {
      const previous = localStorage.getItem(config.storageKey);
      try {
        const parsed = JSON.parse(raw);
        localStorage.setItem(config.storageKey, JSON.stringify(parsed));
        const loaded = storage.load();
        if (!loaded) throw new Error("Invalid mind file");
        this.rememberCurrentMind();
        this.mind = loaded.mind;
        this.maps = loaded.maps;
        this.activeMapId = loaded.activeMapId;
        this.appearance = storage.normalizeAppearance(loaded.appearance, config.appearanceDefaults);
        this.theme = loaded.theme;
        this.customTheme = storage.normalizeCustomTheme(loaded.customTheme);
        this.branchColors = storage.normalizeBranchColors(loaded.branchColors);
        this.hideEditor();
        this.loadMap(this.currentMap());
        this.save();
        this.syncControls();
        this.render();
        this.updateStatus("Mind opened");
      } catch (error) {
        if (previous === null) localStorage.removeItem(config.storageKey);
        else localStorage.setItem(config.storageKey, previous);
        this.updateStatus("Import failed");
      } finally {
        this.el.importMindInput.value = "";
      }
    });
  };

  Controller.prototype.clearRecentMinds = function () {
    this.recentMinds = [];
    saveRecentMinds(this.recentMinds);
    this.updateStatus("Recent minds cleared");
  };

  Controller.prototype.rememberCurrentMind = function () {
    this.captureActiveMap();
    const label = this.mind.nodes[this.mind.rootId]?.label || "Untitled Mind";
    const snapshot = {
      mind: this.mind,
      maps: this.maps,
      activeMapId: this.activeMapId,
      appearance: this.appearance,
      theme: this.theme,
      customTheme: this.customTheme,
      branchColors: this.branchColors
    };
    const raw = JSON.stringify(snapshot);
    if (raw.length > config.limits.maxStoredBytes) return;
    const id = "recent-" + Date.now().toString(36);
    this.recentMinds = [
      { id, label, updatedAt: new Date().toISOString(), snapshot }
    ].concat(this.recentMinds).slice(0, 6);
    saveRecentMinds(this.recentMinds);
  };

  Controller.prototype.openRecentMind = function (recentId) {
    const item = this.recentMinds.find((recent) => recent.id === recentId);
    if (!item) {
      this.updateStatus("Recent mind missing");
      return;
    }
    this.rememberCurrentMind();
    const previous = localStorage.getItem(config.storageKey);
    try {
      localStorage.setItem(config.storageKey, JSON.stringify(item.snapshot));
      const loaded = storage.load();
      if (!loaded) throw new Error("Invalid recent mind");
      this.mind = loaded.mind;
      this.maps = loaded.maps;
      this.activeMapId = loaded.activeMapId;
      this.appearance = storage.normalizeAppearance(loaded.appearance, config.appearanceDefaults);
      this.theme = loaded.theme;
      this.customTheme = storage.normalizeCustomTheme(loaded.customTheme);
      this.branchColors = storage.normalizeBranchColors(loaded.branchColors);
      this.hideEditor();
      this.closeNoteSidebar(false);
      this.actionBarOpen = false;
      this.loadMap(this.currentMap());
      this.save();
      this.syncControls();
      this.render();
      this.updateStatus("Recent mind opened");
    } catch (error) {
      if (previous === null) localStorage.removeItem(config.storageKey);
      else localStorage.setItem(config.storageKey, previous);
      this.updateStatus("Recent mind failed");
    }
  };

  Controller.prototype.viewBox = function () {
    return {
      x: this.camera.x,
      y: this.camera.y,
      width: this.viewport.width / this.camera.scale,
      height: this.viewport.height / this.camera.scale
    };
  };

  Controller.prototype.clampCamera = function () {
    this.camera.scale = utils.clampNumber(this.camera.scale, 0.35, 4, 1);
    const viewWidth = this.viewport.width / this.camera.scale;
    const viewHeight = this.viewport.height / this.camera.scale;
    this.camera.x = utils.clampNumber(this.camera.x, 0, Math.max(0, this.world.width - viewWidth), 0);
    this.camera.y = utils.clampNumber(this.camera.y, 0, Math.max(0, this.world.height - viewHeight), 0);
  };

  Controller.prototype.centerCamera = function () {
    this.camera.x = Math.max(0, (this.world.width - this.viewport.width / this.camera.scale) / 2);
    this.camera.y = Math.max(0, (this.world.height - this.viewport.height / this.camera.scale) / 2);
  };

  Controller.prototype.revealFocus = function () {
    const found = model.findNode(this.store.tree, this.store.focusedId);
    const point = this.positions.get(this.store.focusedId);
    if (!found || !point) return;
    const margin = 48;
    const size = this.layoutEngine.nodeSize(found.node);
    const view = this.viewBox();
    if (point.x - size.width / 2 < view.x + margin) this.camera.x = point.x - size.width / 2 - margin;
    if (point.x + size.width / 2 > view.x + view.width - margin) this.camera.x = point.x + size.width / 2 + margin - view.width;
    if (point.y - size.height / 2 < view.y + margin) this.camera.y = point.y - size.height / 2 - margin;
    if (point.y + size.height / 2 > view.y + view.height - margin) this.camera.y = point.y + size.height / 2 + margin - view.height;
    this.clampCamera();
  };

  Controller.prototype.fitBounds = function (bounds) {
    if (!bounds || !bounds.width || !bounds.height) return;
    const padding = config.layout.ringFitPadding;
    const width = bounds.width + padding * 2;
    const height = bounds.height + padding * 2;
    const scale = Math.min(this.viewport.width / width, this.viewport.height / height, 1);
    this.camera.scale = utils.clampNumber(scale, 0.35, 4, 1);
    this.camera.x = bounds.left + bounds.width / 2 - (this.viewport.width / this.camera.scale) / 2;
    this.camera.y = bounds.top + bounds.height / 2 - (this.viewport.height / this.camera.scale) / 2;
    this.clampCamera();
  };

  Controller.prototype.zoomAt = function (clientX, clientY, deltaY) {
    const rect = this.el.svg.getBoundingClientRect();
    const before = this.clientToWorld(clientX, clientY);
    this.camera.scale = utils.clampNumber(this.camera.scale * (deltaY < 0 ? 1.12 : 0.89), 0.35, 4, 1);
    this.clampCamera();
    const view = this.viewBox();
    this.camera.x = before.x - ((clientX - rect.left) / rect.width) * view.width;
    this.camera.y = before.y - ((clientY - rect.top) / rect.height) * view.height;
    this.clampCamera();
    this.scheduleRender(false);
  };

  Controller.prototype.clientToWorld = function (clientX, clientY) {
    const rect = this.el.svg.getBoundingClientRect();
    const view = this.viewBox();
    return {
      x: view.x + ((clientX - rect.left) / rect.width) * view.width,
      y: view.y + ((clientY - rect.top) / rect.height) * view.height
    };
  };

  Controller.prototype.startPan = function (event) {
    this.isPointerOverCanvas = true;
    if (!this.isSpaceDown || event.button !== 0) return;
    event.preventDefault();
    this.hideEditor();
    this.el.svg.focus();
    this.isPanning = true;
    this.panStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      cameraX: this.camera.x,
      cameraY: this.camera.y,
      view: this.viewBox()
    };
    this.el.svg.classList.add("is-panning");
    this.el.svg.setPointerCapture(event.pointerId);
  };

  Controller.prototype.startNodeDrag = function (event, id) {
    if (this.isSpaceDown || event.button !== 0 || this.editingId) return;
    const found = model.findNode(this.store.tree, id);
    const map = this.currentMap();
    const sourceId = found && map ? model.sourceIdForViewNode(found.node, map.rootNodeId) : null;
    if (!found || !sourceId || sourceId === this.mind.rootId) return;
    event.preventDefault();
    event.stopPropagation();
    this.nodeDrag = {
      pointerId: event.pointerId,
      id,
      sourceId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      targetId: null,
      targetSourceId: null
    };
    this.el.svg.setPointerCapture(event.pointerId);
  };

  Controller.prototype.moveNodeDrag = function (event) {
    const drag = this.nodeDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.active && moved < 6) return;
    if (!drag.active) {
      this.hideEditor();
      this.closeNoteSidebar(false);
      this.actionBarOpen = false;
    }
    drag.active = true;
    event.preventDefault();
    const target = this.nodeDropTarget(event.clientX, event.clientY, drag.sourceId);
    this.setNodeDropTarget(target);
  };

  Controller.prototype.endNodeDrag = function (event) {
    const drag = this.nodeDrag;
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    this.clearNodeDropTarget();
    this.nodeDrag = null;
    if (event && Number.isInteger(event.pointerId) && this.el.svg.hasPointerCapture(event.pointerId)) {
      this.el.svg.releasePointerCapture(event.pointerId);
    }
    if (!drag.active) {
      this.focusNode(drag.id, event);
      return;
    }
    event.preventDefault();
    const target = drag.targetSourceId;
    if (!target) {
      this.updateStatus("Drop on a node to reparent");
      return;
    }
    const validation = this.validateNodeDrop(drag.sourceId, target);
    if (!validation.ok) {
      this.updateStatus(validation.message);
      return;
    }
    this.pushUndoSnapshot();
    this.layoutAnimationPositions = new Map(this.positions);
    if (!model.reparentMindNode(this.mind, drag.sourceId, target)) {
      this.updateStatus("Cannot move node");
      return;
    }
    this.refreshViewTree(drag.sourceId);
    this.afterTreeChange(true, true);
    this.updateStatus("Node moved");
  };

  Controller.prototype.cancelNodeDrag = function (event) {
    if (!this.nodeDrag) return;
    const pointerId = this.nodeDrag.pointerId;
    this.nodeDrag = null;
    this.clearNodeDropTarget();
    if (event && Number.isInteger(event.pointerId) && this.el.svg.hasPointerCapture(event.pointerId)) {
      this.el.svg.releasePointerCapture(event.pointerId);
    } else if (Number.isInteger(pointerId) && this.el.svg.hasPointerCapture(pointerId)) {
      this.el.svg.releasePointerCapture(pointerId);
    }
    this.updateStatus("Move canceled");
  };

  Controller.prototype.nodeDropTarget = function (clientX, clientY, sourceId) {
    const element = document.elementFromPoint(clientX, clientY);
    const group = element && element.closest ? element.closest(".node") : null;
    const id = group ? group.getAttribute("data-node-id") : null;
    const found = id ? model.findNode(this.store.tree, id) : null;
    const map = this.currentMap();
    const targetSourceId = found && map ? model.sourceIdForViewNode(found.node, map.rootNodeId) : null;
    if (!targetSourceId || targetSourceId === sourceId) return null;
    return { id, sourceId: targetSourceId };
  };

  Controller.prototype.setNodeDropTarget = function (target) {
    const drag = this.nodeDrag;
    if (!drag) return;
    if (drag.targetId === (target && target.id)) return;
    this.clearNodeDropTarget();
    if (!target) {
      drag.targetId = null;
      drag.targetSourceId = null;
      return;
    }
    drag.targetId = target.id;
    drag.targetSourceId = target.sourceId;
    const group = this.el.svg.querySelector(`.node[data-node-id="${CSS.escape(target.id)}"]`);
    if (group) group.classList.add("drop-target");
  };

  Controller.prototype.clearNodeDropTarget = function () {
    this.el.svg.querySelectorAll(".node.drop-target").forEach((node) => node.classList.remove("drop-target"));
  };

  Controller.prototype.validateNodeDrop = function (sourceId, targetId) {
    if (sourceId === this.mind.rootId) return { ok: false, message: "Root cannot move" };
    if (sourceId === targetId) return { ok: false, message: "Cannot drop on itself" };
    if (!this.mind.nodes[targetId]) return { ok: false, message: "Drop target missing" };
    if (model.findMindParentId(this.mind, sourceId) === targetId) return { ok: false, message: "Already child of target" };
    if (model.isMindDescendant(this.mind, sourceId, targetId)) return { ok: false, message: "Cannot drop on descendant" };
    if (this.mind.nodes[targetId].children.length >= config.limits.maxChildren) return { ok: false, message: "Target child limit reached" };
    const sourceNode = this.viewNodeForSource(sourceId);
    const targetNode = this.viewNodeForSource(targetId);
    if (!sourceNode || !targetNode) return { ok: false, message: "Move target not visible" };
    const nextDepth = targetNode.depth + 1 + visibleSubtreeDepth(sourceNode);
    if (nextDepth > config.limits.maxDepth) return { ok: false, message: "Move exceeds max depth" };
    return { ok: true, message: "" };
  };

  Controller.prototype.viewNodeForSource = function (sourceId) {
    const map = this.currentMap();
    if (!map) return null;
    const found = model.visibleNodes(this.store.tree)
      .find(({ node }) => model.sourceIdForViewNode(node, map.rootNodeId) === sourceId);
    return found ? found.node : null;
  };

  Controller.prototype.movePan = function (event) {
    if (!this.isPanning || !this.panStart) return;
    const rect = this.el.svg.getBoundingClientRect();
    this.camera.x = this.panStart.cameraX - ((event.clientX - this.panStart.clientX) / rect.width) * this.panStart.view.width;
    this.camera.y = this.panStart.cameraY - ((event.clientY - this.panStart.clientY) / rect.height) * this.panStart.view.height;
    this.clampCamera();
    this.scheduleRender(false);
  };

  Controller.prototype.endPan = function (event) {
    if (!this.isPanning) return;
    this.isPanning = false;
    this.panStart = null;
    this.el.svg.classList.remove("is-panning");
    if (event && Number.isInteger(event.pointerId) && this.el.svg.hasPointerCapture(event.pointerId)) {
      this.el.svg.releasePointerCapture(event.pointerId);
    }
  };

  Controller.prototype.positionEditor = function () {
    if (!this.editingId || this.el.nodeEditor.hidden) return;
    const found = model.findNode(this.store.tree, this.editingId);
    const point = this.positions.get(this.editingId);
    if (!found || !point) return;
    const rect = this.renderer.editorRect(found.node, point, this.viewBox());
    this.el.nodeEditor.style.left = rect.left + "px";
    this.el.nodeEditor.style.top = rect.top + "px";
    this.el.nodeEditor.style.width = rect.width + "px";
    this.el.nodeEditor.style.height = rect.height + "px";
  };

  Controller.prototype.positionActionBar = function () {
    if (!this.el.nodeActionBar) return;
    if (!this.actionBarOpen || (this.editingId && !this.el.nodeEditor.hidden)) {
      this.el.nodeActionBar.hidden = true;
      return;
    }
    const found = model.findNode(this.store.tree, this.store.focusedId);
    const point = this.positions.get(this.store.focusedId);
    if (!found || !point) {
      this.el.nodeActionBar.hidden = true;
      return;
    }
    const rect = this.renderer.editorRect(found.node, point, this.viewBox());
    const wrapRect = this.el.svg.getBoundingClientRect();
    const bar = this.el.nodeActionBar;
    bar.hidden = false;
    bar.style.left = rect.left + rect.width / 2 + "px";
    bar.style.top = Math.min(wrapRect.height - 52, rect.top + rect.height + 12) + "px";
    requestAnimationFrame(() => {
      const width = bar.offsetWidth;
      const left = Math.max(12 + width / 2, Math.min(wrapRect.width - 12 - width / 2, rect.left + rect.width / 2));
      bar.style.left = left + "px";
    });
  };

  function normalizeWheelDelta(event, axis) {
    const raw = axis === "x" ? event.deltaX || event.deltaY : event.deltaY || event.deltaX;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return raw * 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return raw * (axis === "x" ? window.innerWidth : window.innerHeight);
    return raw;
  }

  function maxDepth(node) {
    if (!node.children.length) return node.depth;
    return Math.max(node.depth, ...node.children.map(maxDepth));
  }

  function visibleSubtreeDepth(node) {
    if (!node.children.length) return 0;
    return Math.max(...node.children.map((child) => 1 + visibleSubtreeDepth(child)));
  }

  function mindPathItems(mind, sourceId) {
    const items = [];
    const seen = new Set();
    let currentId = sourceId;
    while (currentId && mind.nodes[currentId] && !seen.has(currentId)) {
      seen.add(currentId);
      items.unshift({ id: currentId, label: mind.nodes[currentId].label });
      if (currentId === mind.rootId) break;
      currentId = model.findMindParentId(mind, currentId);
    }
    return items.length ? items : [{ id: mind.rootId, label: "Chart Title" }];
  }

  function focusContext(tree, focusedId) {
    const siblingIds = new Set();
    const pathNodeIds = new Set();
    const pathChildIds = new Set();
    collectFocusPath(tree, focusedId, [], { siblingIds, pathNodeIds, pathChildIds });
    return { siblingIds, pathNodeIds, pathChildIds };
  }

  function collectFocusPath(node, focusedId, path, context) {
    const nextPath = path.concat(node);
    if (node.id === focusedId) {
      nextPath.forEach((item, index) => {
        context.pathNodeIds.add(item.id);
        if (index > 0) context.pathChildIds.add(item.id);
      });
      const parent = path[path.length - 1];
      if (parent) parent.children.forEach((child) => context.siblingIds.add(child.id));
      return true;
    }
    return node.children.some((child) => collectFocusPath(child, focusedId, nextPath, context));
  }

  function mindFilename(label) {
    const slug = utils.cleanId(label.toLowerCase().replace(/\s+/g, "-"), "mind");
    return slug + ".mind.json";
  }

  function themeFilename(label) {
    const slug = utils.cleanId(label.toLowerCase().replace(/\s+/g, "-"), "theme");
    return slug + ".concen-theme.json";
  }

  function inferColorScheme(hex) {
    const clean = String(hex || "#ffffff").replace("#", "");
    const red = parseInt(clean.slice(0, 2), 16);
    const green = parseInt(clean.slice(2, 4), 16);
    const blue = parseInt(clean.slice(4, 6), 16);
    return (red * 299 + green * 587 + blue * 114) / 1000 > 140 ? "light" : "dark";
  }

  function noteLinkItems(note, mind) {
    const items = [];
    const seen = new Set();
    const text = String(note || "");
    const urlPattern = /\bhttps?:\/\/[^\s<>"']+/gi;
    for (const match of text.matchAll(urlPattern)) {
      const href = match[0].replace(/[),.;]+$/, "");
      if (seen.has("url:" + href)) continue;
      seen.add("url:" + href);
      items.push({ kind: "url", href, label: href });
    }
    const nodePattern = /\[\[([^\]]{1,80})\]\]/g;
    for (const match of text.matchAll(nodePattern)) {
      const label = match[1].trim().toLowerCase();
      const node = Object.values(mind.nodes).find((item) => item.label.trim().toLowerCase() === label);
      if (!node || seen.has("node:" + node.id)) continue;
      seen.add("node:" + node.id);
      items.push({ kind: "node", sourceId: node.id, label: "Node: " + node.label });
    }
    return items.slice(0, 8);
  }

  function backlinkItems(mind, targetNode) {
    const targetLabel = targetNode.label.trim().toLowerCase();
    if (!targetLabel) return [];
    return Object.values(mind.nodes)
      .filter((node) => node.id !== targetNode.id && noteLinksToLabel(node.note, targetLabel))
      .map((node) => ({ sourceId: node.id, label: node.label }));
  }

  function noteLinksToLabel(note, targetLabel) {
    const text = String(note || "");
    const nodePattern = /\[\[([^\]]{1,80})\]\]/g;
    for (const match of text.matchAll(nodePattern)) {
      if (match[1].trim().toLowerCase() === targetLabel) return true;
    }
    return false;
  }

  function nodeSearchDetail(mind, node) {
    const parts = [mindPathItems(mind, node.id).map((item) => item.label).join(" / ")];
    if (node.status) parts.push(titleCase(node.status));
    if (node.priority) parts.push(titleCase(node.priority));
    if (node.note) parts.push("note");
    return parts.filter(Boolean).join(" · ");
  }

  function welcomeTemplateTree(template) {
    const child = (label, children, note, status, priority) => ({
      label,
      note: note || "",
      status: status || "open",
      priority: priority || "normal",
      markerEnabled: false,
      tags: [],
      children: children || []
    });
    const templates = {
      blank: child("Chart Title", []),
      tutorial: child("Ctrl+click this node", [
        child("Chapter 1: Basics", [
          child("1. Select Nodes", [
            child("Click Practice", [], "Click this node. Notice the focus ring and action bar."),
            child("2. Add Children", [
              child("Add Here", [], "Focus this node and press Enter. A child appears. You can delete practice children later."),
              child("3. Rename", [], "Focus this node, press Shift+Enter, type a new label, then press Enter.")
            ], "Focus [[Add Here]], then press Enter once. That creates a child under the focused node. Next: [[3. Rename]].", "open")
          ], "Click any node to focus it. Focus decides where Enter, notes, and commands apply. Task: click [[Click Practice]]. Next: [[2. Add Children]].", "active", "high"),
          child("Chapter 2: Notes", [
            child("1. Inspector", [
              child("Return Focus", [], "Press Ctrl+Enter while this note is open. Focus returns to this node."),
              child("2. Metadata", [
                child("Status Example", [], "Change status to Active and priority to High. Turn marker on to see the symbol."),
                child("3. Tags", [], "Add tag tutorial, then search tutorial from Ctrl+K.")
              ], "Status colors the priority marker. Priority changes the symbol. Task: edit [[Status Example]]. Next: [[3. Tags]].", "open")
            ], "Ctrl+Enter opens and closes the inspector. Task: click [[Return Focus]], open notes, then Ctrl+Enter back to canvas. Next: [[2. Metadata]].", "active"),
            child("Chapter 3: Links", [
              child("1. Type Link", [
                child("Link Target", [], "This is target for practice links."),
                child("2. Backlinks", [
                  child("Backlink Target", [], "This node is linked from lesson note. Linked from should show where it came from."),
                  child("3. Follow Path", [], "Click this node, then use map path controls above canvas.")
                ], "This note links to [[Backlink Target]]. Open that node and watch Linked from appear. Next: [[3. Follow Path]].", "open")
              ], "Type [[ in this note and choose Link Target. After inserting, look below note for link chip. Next: [[2. Backlinks]].", "active"),
              child("Chapter 4: Commands", [
                child("1. Search", [
                  child("Find This Node", [], "Press Ctrl+K, type Find This, press Enter."),
                  child("2. Actions", [
                    child("Action Target", [], "Use Ctrl+K and type marker, status, or priority while this node is focused."),
                    child("3. Move Command", [], "Focus this node, press Ctrl+K, type move, choose Action Target.")
                  ], "Commands can edit focused node. Task: focus [[Action Target]], press Ctrl+K, type marker. Next: [[3. Move Command]].", "open")
                ], "Ctrl+K searches labels, notes, tags, status, and priority. Task: search for [[Find This Node]]. Next: [[2. Actions]].", "active"),
                child("Chapter 5: Moving", [
                  child("1. Drag Move", [
                    child("Drag Me", [], "Drag this node onto Drop Zone."),
                    child("Drop Zone", [], "Drop Drag Me here."),
                    child("2. Animation", [
                      child("Watch Siblings", [], "When nodes shift, they settle with a short animation."),
                      child("3. Safety", [], "Use Ctrl+Z after a move if you dislike result.")
                    ], "Moves displace nearby nodes. Watch siblings settle after move. Next: [[3. Safety]].", "open")
                  ], "Drag one node onto another to make it child. Task: drag [[Drag Me]] onto [[Drop Zone]]. Next: [[2. Animation]].", "active"),
                  child("Chapter 6: Maps", [
                    child("1. Open Map", [
                      child("Nested Practice", [], "Focus this node and press Alt+Enter to open it as its own map."),
                      child("2. Map Path", [
                        child("Path Buttons", [], "Use path buttons above canvas to climb back to parent maps."),
                        child("3. Finish", [], "Open Welcome from Ctrl+K, then choose real template or blank mind. Done.")
                      ], "Path buttons show where this map lives. Next: [[3. Finish]].", "open")
                    ], "Any node can become map. Task: focus [[Nested Practice]], press Alt+Enter. Next: [[2. Map Path]].", "active")
                  ], "Maps keep large topics focused. Start at [[1. Open Map]]. Return to previous view with Ctrl+Left or path trail above canvas.", "done")
                ], "This chapter is practice sandbox for reparenting. Start at [[1. Drag Move]]. Next chapter is child node [[Chapter 6: Maps]].", "waiting")
              ], "Ctrl+K is search plus action palette. Start at [[1. Search]]. Next chapter is child node [[Chapter 5: Moving]].", "open")
            ], "Links use exact node labels inside double brackets. Start at [[1. Type Link]]. Next chapter is child node [[Chapter 4: Commands]].", "waiting")
          ], "Notes hold details without crowding ring. Start at [[1. Inspector]]. Next chapter is child node [[Chapter 3: Links]].", "open")
        ], "Open this chapter with Alt+Enter. It contains basics lessons and child node [[Chapter 2: Notes]]. Return to previous view with Ctrl+Left or path trail above canvas.", "active", "high")
      ], "Start here. Ctrl+click opened this note.\n\nNext: click [[Chapter 1: Basics]], then press Alt+Enter to enter chapter map.\n\nChapters are nested one inside previous, so each chapter view stays focused. Return with Ctrl+Left or path trail above canvas.", "active", "critical"),
      project: child("Project Plan", [
        child("Goals", [child("Outcome"), child("Constraints")]),
        child("Workstreams", [child("Design"), child("Build"), child("Launch")]),
        child("Risks", [child("Open Questions", [], "", "waiting", "high")]),
        child("Next Actions", [child("Owner"), child("Due Date")], "", "active", "high")
      ], "Use notes for decisions and [[Risks]] for linked references.", "active"),
      decision: child("Decision Map", [
        child("Decision", [child("Recommendation"), child("Deadline")], "", "active", "high"),
        child("Options", [child("Option A"), child("Option B"), child("Option C")]),
        child("Evidence", [child("Pros"), child("Cons"), child("Unknowns", [], "", "waiting", "high")]),
        child("Stakeholders", [child("Approver"), child("Impacted Teams")])
      ], "Compare options, then link evidence with [[Evidence]]."),
      research: child("Research Notes", [
        child("Questions", [child("Primary Question"), child("Follow-ups")], "", "active"),
        child("Sources", [child("Articles"), child("Interviews"), child("Data")]),
        child("Findings", [child("Patterns"), child("Contradictions"), child("Quotes")]),
        child("Synthesis", [child("Summary"), child("Next Research")])
      ], "Use [[Findings]] links as notes mature."),
      issues: child("Issue Tracker", [
        child("Open", [child("Bug"), child("Request")], "", "open", "high"),
        child("Active", [child("In Progress"), child("Blocked", [], "", "waiting", "critical")], "", "active"),
        child("Waiting", [child("Needs Reply"), child("External")], "", "waiting"),
        child("Done", [child("Shipped"), child("Archived")], "", "done")
      ], "Turn markers on for the tickets that need status/priority at a glance.")
    };
    return templates[template] || null;
  }

  function titleCase(value) {
    const text = String(value || "");
    return text ? text[0].toUpperCase() + text.slice(1) : "";
  }

  function activeNodeLinkRange(input) {
    const cursor = input.selectionStart;
    if (cursor === null || cursor !== input.selectionEnd) return null;
    const before = input.value.slice(0, cursor);
    const start = before.lastIndexOf("[[");
    if (start < 0) return null;
    const close = before.lastIndexOf("]]");
    if (close > start) return null;
    const query = before.slice(start + 2);
    if (/[\n\r\]]/.test(query) || query.length > 80) return null;
    return { start, end: cursor, query };
  }

  function styleTokens(style, dark) {
    if (style === "papery") return dark ? darkPaperyTokens() : lightPaperyTokens();
    if (style === "blueprint") return blueprintTokens();
    if (style === "terminal") return terminalTokens();
    return null;
  }

  function blueprintTokens() {
    return {
      focus: "#38bdf8",
      "focus-soft": "rgba(56, 189, 248, 0.22)",
      "canvas-bg": "#0b2431",
      "canvas-grid": "rgba(125, 211, 252, 0.16)",
      "canvas-wash": "rgba(14, 116, 144, 0.18)",
      "ring-guide": "rgba(125, 211, 252, 0.46)",
      "node-fill": "rgba(8, 47, 73, 0.88)",
      "node-ink": "#e0f2fe",
      "root-node-fill": "#e0f2fe",
      "root-node-ink": "#082f49",
      "node-shadow": "drop-shadow(0 0 10px rgba(56, 189, 248, 0.16))"
    };
  }

  function terminalTokens() {
    return {
      focus: "#22c55e",
      "focus-soft": "rgba(34, 197, 94, 0.22)",
      "canvas-bg": "#030712",
      "canvas-grid": "rgba(34, 197, 94, 0.12)",
      "canvas-wash": "rgba(15, 23, 42, 0.34)",
      "ring-guide": "rgba(34, 197, 94, 0.34)",
      "node-fill": "rgba(2, 6, 23, 0.9)",
      "node-ink": "#bbf7d0",
      "root-node-fill": "#22c55e",
      "root-node-ink": "#03120a",
      "node-shadow": "drop-shadow(0 0 7px rgba(34, 197, 94, 0.24))"
    };
  }

  function lightPaperyTokens() {
    return {
      bg: "#efe6cf",
      surface: "rgba(255, 251, 240, 0.74)",
      "surface-solid": "#fff7e6",
      "surface-raised": "rgba(255, 253, 246, 0.9)",
      "surface-recessed": "rgba(246, 239, 220, 0.72)",
      ink: "#292218",
      muted: "#6f624e",
      label: "#76664d",
      field: "rgba(255, 253, 246, 0.92)",
      "field-hover": "#fffdf6",
      control: "linear-gradient(180deg, rgba(255, 252, 242, 0.96), rgba(238, 226, 201, 0.88))",
      "control-hover": "linear-gradient(180deg, #fffdf6, rgba(233, 219, 190, 0.92))",
      "control-pressed": "linear-gradient(180deg, rgba(226, 210, 178, 0.9), rgba(250, 244, 230, 0.96))",
      "control-ink": "#292218",
      "canvas-bg": "#f7f0dc",
      "canvas-grid": "rgba(117, 94, 54, 0.055)",
      "canvas-wash": "rgba(255, 252, 242, 0.62)",
      "ring-guide": "rgba(117, 94, 54, 0.26)",
      "node-fill": "rgba(255, 252, 242, 0.94)",
      "node-ink": "#292218",
      "shadow-sm": "0 1px 1px rgba(80, 62, 35, 0.08), 0 1px 0 rgba(255, 255, 255, 0.58) inset",
      "shadow-md": "0 8px 18px rgba(80, 62, 35, 0.12)",
      "shadow-lg": "0 18px 42px rgba(80, 62, 35, 0.16)",
      "node-shadow": "drop-shadow(0 5px 8px rgba(80, 62, 35, 0.13))"
    };
  }

  function darkPaperyTokens() {
    return {
      bg: "#15120d",
      surface: "rgba(36, 30, 22, 0.78)",
      "surface-solid": "#231d15",
      "surface-raised": "rgba(47, 39, 28, 0.92)",
      "surface-recessed": "rgba(30, 25, 18, 0.82)",
      "glass-border": "rgba(238, 220, 184, 0.18)",
      hairline: "rgba(238, 220, 184, 0.12)",
      field: "rgba(38, 31, 22, 0.94)",
      "field-hover": "rgba(51, 42, 30, 0.96)",
      control: "linear-gradient(180deg, rgba(66, 55, 40, 0.9), rgba(42, 34, 24, 0.92))",
      "control-hover": "linear-gradient(180deg, rgba(78, 65, 47, 0.94), rgba(50, 41, 30, 0.96))",
      "control-pressed": "linear-gradient(180deg, rgba(35, 28, 20, 0.96), rgba(63, 52, 37, 0.9))",
      "control-ink": "#f5ead2",
      ink: "#f5ead2",
      muted: "#c9b895",
      label: "#b8a681",
      "canvas-bg": "#211b13",
      "canvas-grid": "rgba(238, 220, 184, 0.052)",
      "canvas-wash": "rgba(80, 65, 43, 0.34)",
      "ring-guide": "rgba(238, 220, 184, 0.2)",
      "node-fill": "rgba(50, 41, 29, 0.94)",
      "node-ink": "#f7ecd4",
      "root-node-fill": "#f3dfb4",
      "root-node-ink": "#1d160d",
      "shadow-sm": "0 1px 1px rgba(0, 0, 0, 0.28), 0 1px 0 rgba(255, 247, 222, 0.06) inset",
      "shadow-md": "0 10px 24px rgba(0, 0, 0, 0.3)",
      "shadow-lg": "0 22px 54px rgba(0, 0, 0, 0.42)",
      "node-shadow": "drop-shadow(0 7px 12px rgba(0, 0, 0, 0.32))"
    };
  }

  function loadRecentMinds() {
    try {
      const raw = localStorage.getItem(config.recentMindsKey);
      if (!raw || raw.length > config.limits.maxStoredBytes) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && item.snapshot && item.id)
        .map((item) => ({
          id: utils.cleanId(item.id, "recent"),
          label: utils.cleanLabel(item.label) || "Untitled Mind",
          updatedAt: item.updatedAt || "",
          snapshot: item.snapshot
        }))
        .slice(0, 6);
    } catch (error) {
      return [];
    }
  }

  function saveRecentMinds(items) {
    try {
      localStorage.setItem(config.recentMindsKey, JSON.stringify(items.slice(0, 6)));
    } catch (error) {
      return false;
    }
    return true;
  }

  RingMapChart.Controller = Controller;
})(window);
