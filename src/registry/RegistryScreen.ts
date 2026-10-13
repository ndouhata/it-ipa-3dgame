// キャラクター登録画面。GLBの検証 → 3Dプレビュー → アニメ割当 → 調整 → 「歩かせてみる」 → 保存。
import { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { CharacterInstance } from '../character/CharacterInstance';
import { loadContainerFromBlob } from '../character/CharacterLoader';
import { CharacterRepository } from '../character/CharacterRepository';
import { analyzeContainer, formatBytes, precheckGlb, type GlbAnalysis, type Issue } from '../character/glbInspect';
import {
  ANIM_LABELS, DEFAULT_LOCOMOTION, OPTIONAL_ANIMS, REQUIRED_ANIMS, ROLE_LABELS,
  type CharacterDefinition, type CharacterRole, type LogicalAnim,
} from '../character/CharacterDefinition';
import { h, clear } from '../ui/dom';

export interface RegistryCallbacks {
  activeIds: () => { hero: string | null; partner: string | null; npcs: Record<string, string> };
  npcList: { id: string; name: string }[];
  setActive: (role: 'hero' | 'partner', id: string | null) => void;
  setNpcAppearance: (npcId: string, charId: string | null) => void;
  onClose: (changed: boolean) => void;
}

interface Draft {
  editingId: string | null;
  name: string;
  role: CharacterRole;
  blob: Blob | null;
  blobIsNew: boolean;
  fileName: string;
  assetId: string | null;
  container: AssetContainer | null;
  analysis: GlbAnalysis | null;
  issues: Issue[];
  animationMap: Partial<Record<LogicalAnim, string>>;
  transform: { scale: number; rotationY: number; yOffset: number };
  locomotion: { walkSpeed: number; runSpeed: number; animSpeedScale: number };
  stripRootMotion: boolean;
  rawHeight: number;
  rawMinY: number;
  testPassed: boolean;
  useAsActive: boolean;
}

const emptyDraft = (): Draft => ({
  editingId: null, name: '', role: 'hero', blob: null, blobIsNew: false, fileName: '', assetId: null,
  container: null, analysis: null, issues: [], animationMap: {},
  transform: { scale: 1, rotationY: 0, yOffset: 0 }, locomotion: { ...DEFAULT_LOCOMOTION },
  stripRootMotion: true, rawHeight: 1.7, rawMinY: 0, testPassed: false, useAsActive: true,
});

const TEST_SEQUENCE: { state: 'idle' | 'walk' | 'run'; seconds: number; label: string }[] = [
  { state: 'idle', seconds: 2, label: '待機' },
  { state: 'walk', seconds: 4.5, label: '歩行' },
  { state: 'run', seconds: 3.5, label: '走行' },
  { state: 'idle', seconds: 2, label: '待機' },
];

export class RegistryScreen {
  readonly scene: Scene;
  private camera: ArcRotateCamera;
  private root: HTMLElement | null = null;
  private side!: HTMLElement;
  private nowLabel!: HTMLElement;
  private draft: Draft = emptyDraft();
  private instance: CharacterInstance | null = null;
  private changed = false;
  private loading = false;
  private test: { t: number; angle: number } | null = null;
  private freeAnim: string | null = null;

  constructor(engine: AbstractEngine, private parent: HTMLElement, private cb: RegistryCallbacks) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.13, 0.16, 0.24, 1);
    this.camera = new ArcRotateCamera('reg-cam', Math.PI / 2, 1.25, 4.5, new Vector3(0, 0.9, 0), this.scene);
    this.camera.lowerRadiusLimit = 0.8;
    this.camera.upperRadiusLimit = 30;
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.pinchDeltaPercentage = 0.02;
    this.camera.panningSensibility = 0;
    this.camera.minZ = 0.05;
    const hemi = new HemisphericLight('reg-hemi', new Vector3(0, 1, 0.3), this.scene);
    hemi.intensity = 0.8;
    const dir = new DirectionalLight('reg-dir', new Vector3(-0.4, -1, 0.6), this.scene);
    dir.intensity = 0.7;
    this.buildStage();
    this.scene.onBeforeRenderObservable.add(() => this.tick(this.scene.getEngine().getDeltaTime() / 1000));
  }

  private buildStage() {
    const s = this.scene;
    const floor = MeshBuilder.CreateDisc('reg-floor', { radius: 6, tessellation: 64 }, s);
    floor.rotation.x = Math.PI / 2;
    const fm = new StandardMaterial('reg-floor-m', s);
    fm.diffuseColor = new Color3(0.22, 0.26, 0.36);
    fm.specularColor = Color3.Black();
    floor.material = fm;
    const lines: Vector3[][] = [];
    for (let i = -5; i <= 5; i++) {
      lines.push([new Vector3(i, 0.005, -5), new Vector3(i, 0.005, 5)]);
      lines.push([new Vector3(-5, 0.005, i), new Vector3(5, 0.005, i)]);
    }
    const grid = MeshBuilder.CreateLineSystem('reg-grid', { lines }, s);
    grid.color = new Color3(0.35, 0.42, 0.58);
    // 身長1.7mの目安ポール
    const pole = MeshBuilder.CreateBox('reg-pole', { width: 0.05, height: 1.7, depth: 0.05 }, s);
    pole.position.set(1.1, 0.85, 0);
    const pm = new StandardMaterial('reg-pole-m', s);
    pm.diffuseColor = new Color3(0.9, 0.75, 0.3);
    pm.alpha = 0.5;
    pole.material = pm;
    // 正面方向（+Z）の矢印
    const arrow = MeshBuilder.CreateCylinder('reg-front', { height: 0.6, diameterTop: 0, diameterBottom: 0.18, tessellation: 3 }, s);
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.02, 1.1);
    const am = new StandardMaterial('reg-front-m', s);
    am.diffuseColor = new Color3(0.4, 0.85, 1);
    am.emissiveColor = new Color3(0.2, 0.4, 0.5);
    arrow.material = am;
  }

  get isOpen() { return this.root !== null; }

  open() {
    this.changed = false;
    this.camera.attachControl(this.scene.getEngine().getRenderingCanvas()!, true);
    this.nowLabel = h('div', { class: 'panel registry-anim-now', text: 'GLBを選ぶとここに表示されます' });
    this.side = h('div', { class: 'registry-side' });
    const view = h('div', { class: 'registry-view' }, this.nowLabel,
      h('div', { class: 'registry-view-tools' },
        h('button', { class: 'btn btn-small', text: '正面', onclick: () => this.viewFront() }),
        h('button', { class: 'btn btn-small', text: '横', onclick: () => { this.camera.alpha = 0; } }),
        h('button', { class: 'btn btn-small', text: '背面', onclick: () => { this.camera.alpha = -Math.PI / 2; } }),
        h('button', { class: 'btn btn-small', text: '拡大', onclick: () => { this.camera.radius *= 0.8; } }),
        h('button', { class: 'btn btn-small', text: '縮小', onclick: () => { this.camera.radius *= 1.25; } })));
    this.root = h('div', { class: 'registry' }, this.side, view);
    this.parent.append(this.root);
    void this.renderSide();
  }

  close() {
    this.stopTest();
    this.disposeModel();
    this.draft = emptyDraft();
    this.camera.detachControl();
    this.root?.remove();
    this.root = null;
    this.cb.onClose(this.changed);
  }

  render() { this.scene.render(); }

  private viewFront() {
    // モデルの正面(+Z)からカメラで見る
    this.camera.alpha = Math.PI / 2;
    this.camera.beta = 1.3;
  }

  // ---------- 画面 ----------
  private async renderSide() {
    const d = this.draft;
    clear(this.side);
    const list = await CharacterRepository.list().catch(() => [] as CharacterDefinition[]);
    const active = this.cb.activeIds();

    this.side.append(h('div', { class: 'row spread' },
      h('div', { class: 'panel-title', text: 'キャラクター登録' }),
      h('button', { class: 'btn btn-close', text: '戻る', onclick: () => this.close() })));

    // 登録済み
    const listBox = h('div', { class: 'char-list' });
    if (!list.length) listBox.append(h('div', { class: 'small muted', text: 'まだ登録されていません。GLBが無い場合は仮の人形で遊べます。' }));
    for (const c of list) {
      const isHero = active.hero === c.id, isPartner = active.partner === c.id;
      const npcFor = Object.entries(active.npcs).filter(([, v]) => v === c.id).map(([k]) => this.cb.npcList.find((n) => n.id === k)?.name ?? k);
      const item = h('div', { class: 'card char-item' },
        h('div', null, h('div', { class: 'nm', text: c.name }),
          h('div', { class: 'small muted', text: `${ROLE_LABELS[c.role]}・${formatBytes(c.fileSize)}・アニメ${c.stats.animationCount}` }),
          isHero ? h('div', { class: 'active', text: '● 主人公として使用中' }) : null,
          isPartner ? h('div', { class: 'active', text: '● パートナーとして使用中' }) : null,
          npcFor.length ? h('div', { class: 'active', text: `● NPC：${npcFor.join('、')}` }) : null),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn btn-small', text: '編集', onclick: () => void this.edit(c) }),
          c.role === 'hero' ? h('button', { class: 'btn btn-small', text: isHero ? '解除' : '使う', onclick: () => { this.cb.setActive('hero', isHero ? null : c.id); this.changed = true; void this.renderSide(); } }) : null,
          c.role === 'partner' ? h('button', { class: 'btn btn-small', text: isPartner ? '解除' : '使う', onclick: () => { this.cb.setActive('partner', isPartner ? null : c.id); this.changed = true; void this.renderSide(); } }) : null,
          c.role === 'npc' ? this.npcSelect(c.id, active.npcs) : null,
          h('button', { class: 'btn btn-small btn-danger', text: '削除', onclick: () => void this.remove(c) })));
      listBox.append(item);
    }
    this.side.append(h('h3', { text: '登録済みキャラクター' }), listBox);

    // 新規/編集フォーム
    this.side.append(h('h3', { text: d.editingId ? `編集：${d.name}` : '新しく登録する' }));
    const nameInput = h('input', { type: 'text', value: d.name, placeholder: '例：アルト', maxlength: '16' }) as HTMLInputElement;
    nameInput.oninput = () => { d.name = nameInput.value; this.refreshSave(); };
    const roleSel = h('select', null, ...(['hero', 'partner', 'npc'] as CharacterRole[]).map((r) => h('option', { value: r, text: ROLE_LABELS[r], selected: d.role === r }))) as HTMLSelectElement;
    roleSel.onchange = () => { d.role = roleSel.value as CharacterRole; void this.renderSide(); };
    this.side.append(h('label', { class: 'field' }, '名前', nameInput), h('label', { class: 'field' }, '役割', roleSel));

    const fileInput = h('input', { type: 'file', accept: '.glb,model/gltf-binary', style: { display: 'none' } }) as HTMLInputElement;
    fileInput.onchange = () => { const f = fileInput.files?.[0]; if (f) void this.loadFile(f, f.name); };
    const drop = h('div', { class: 'dropzone', onclick: () => fileInput.click() },
      this.loading ? '読み込み中…' : d.fileName ? `📦 ${d.fileName}（クリックで変更）` : 'GLBファイルを選択、またはここへドロップ');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.loadFile(f, f.name);
    });
    this.side.append(drop, fileInput,
      h('div', { class: 'row small' }, 'サンプル：',
        h('button', { class: 'btn btn-small', text: '主人公', onclick: () => void this.loadSample('samples/sample-hero.glb', 'サンプル主人公', 'hero') }),
        h('button', { class: 'btn btn-small', text: 'パートナー', onclick: () => void this.loadSample('samples/sample-partner.glb', 'サンプル相棒', 'partner') }),
        h('button', { class: 'btn btn-small', text: 'ガチムチ', onclick: () => void this.loadSample('samples/sample-macho.glb', 'ガチムチ', 'hero') })));

    if (d.issues.length) this.side.append(h('div', { class: 'issues' }, ...d.issues.map((i) => h('div', { class: `issue ${i.level}`, text: i.message }))));

    if (d.container && d.analysis) {
      const a = d.analysis;
      // アニメーション割当（名前の決め打ちはしない。一覧から選ぶ）
      const assign = h('div', { class: 'card' }, h('h4', { text: 'アニメーション割当' }));
      if (!a.animationNames.length) assign.append(h('div', { class: 'small muted', text: 'このGLBにはアニメーションがありません。' }));
      for (const slot of [...REQUIRED_ANIMS, ...OPTIONAL_ANIMS]) {
        if (!a.animationNames.length) break;
        const sel = h('select', null, h('option', { value: '', text: '（未割当）' }),
          ...a.animationNames.map((n) => h('option', { value: n, text: `${n}（${a.durations[n].toFixed(1)}秒）`, selected: d.animationMap[slot] === n }))) as HTMLSelectElement;
        sel.onchange = () => {
          d.animationMap[slot] = sel.value || undefined;
          d.testPassed = false;
          this.rebuildInstance();
          this.refreshSave();
          if (sel.value) this.playFree(sel.value);
        };
        assign.append(h('label', { class: 'field' }, ANIM_LABELS[slot], sel));
      }
      if (a.animationNames.length) {
        assign.append(h('div', { class: 'small muted', text: 'GLB内のアニメーション（クリックで再生）' }),
          h('div', { class: 'anim-list' }, ...a.animationNames.map((n) => h('button', { class: 'btn btn-small', text: `▶ ${n}`, onclick: () => this.playFree(n) }))));
      }
      this.side.append(assign);

      // 調整
      const adj = h('div', { class: 'card' }, h('h4', { text: '見た目の調整' }),
        this.slider('大きさ（Scale）', d.transform.scale, 0.01, 5, 0.01, (v) => { d.transform.scale = v; this.applyTransform(); }, (v) => `${v.toFixed(2)}倍（身長 約${(d.rawHeight * v).toFixed(2)}m）`),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-small', text: '身長1.7mに合わせる', onclick: () => { d.transform.scale = +(1.7 / Math.max(0.01, d.rawHeight)).toFixed(3); d.transform.yOffset = +(-d.rawMinY * d.transform.scale).toFixed(3); this.applyTransform(); void this.renderSide(); } }),
          h('button', { class: 'btn btn-small', text: '足を地面に合わせる', onclick: () => { d.transform.yOffset = +(-d.rawMinY * d.transform.scale).toFixed(3); this.applyTransform(); void this.renderSide(); } })),
        this.slider('向き（Y回転）', Math.round((d.transform.rotationY * 180) / Math.PI), -180, 180, 1, (v) => { d.transform.rotationY = (v * Math.PI) / 180; this.applyTransform(); }, (v) => `${v}°（水色の矢印が正面）`),
        this.slider('地面からの高さ', d.transform.yOffset, -3, 3, 0.01, (v) => { d.transform.yOffset = v; this.applyTransform(); }, (v) => `${v.toFixed(2)}m`),
        this.slider('歩行速度（足の動きに合わせる）', d.locomotion.walkSpeed, 0.5, 6, 0.1, (v) => { d.locomotion.walkSpeed = v; this.rebuildInstance(); }, (v) => `${v.toFixed(1)} m/s`),
        this.slider('走行速度（足の動きに合わせる）', d.locomotion.runSpeed, 1, 12, 0.1, (v) => { d.locomotion.runSpeed = v; this.rebuildInstance(); }, (v) => `${v.toFixed(1)} m/s`),
        this.checkbox('ルートモーションを除去（その場で足踏みさせる）', d.stripRootMotion, (v) => { d.stripRootMotion = v; this.rebuildInstance(); }));
      this.side.append(adj);

      // テスト＆保存
      const testBtn = h('button', { class: 'btn btn-primary', text: this.test ? 'テスト中…' : '▶ 歩かせてみる（待機→歩行→走行→待機）', onclick: () => this.startTest() });
      const saveBtn = h('button', { class: 'btn btn-primary', text: d.editingId ? '変更を保存' : '登録する', 'data-role': 'save', onclick: () => void this.save() });
      const useActive = d.role !== 'npc' ? this.checkbox(`保存後、${ROLE_LABELS[d.role]}として使う`, d.useAsActive, (v) => { d.useAsActive = v; }) : null;
      this.side.append(h('div', { class: 'card' }, h('h4', { text: '確認して登録' }), testBtn,
        h('div', { class: 'small muted', 'data-role': 'save-hint', style: { margin: '6px 0' } }), useActive, saveBtn));
      this.refreshSave();
    }
  }

  private npcSelect(charId: string, npcs: Record<string, string>) {
    const sel = h('select', { class: 'btn-small' }, h('option', { value: '', text: 'NPC割当…' }),
      ...this.cb.npcList.map((n) => h('option', { value: n.id, text: `${npcs[n.id] === charId ? '✔ ' : ''}${n.name}` }))) as HTMLSelectElement;
    sel.onchange = () => {
      if (!sel.value) return;
      this.cb.setNpcAppearance(sel.value, npcs[sel.value] === charId ? null : charId);
      this.changed = true;
      void this.renderSide();
    };
    return sel;
  }

  private slider(label: string, value: number, min: number, max: number, step: number, onInput: (v: number) => void, fmt: (v: number) => string) {
    const val = h('span', { class: 'val', text: fmt(value) });
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
    input.oninput = () => { const v = Number(input.value); val.textContent = fmt(v); onInput(v); };
    return h('label', { class: 'field' }, h('div', { class: 'row spread' }, h('span', { text: label }), val), input);
  }

  private checkbox(label: string, value: boolean, onChange: (v: boolean) => void) {
    const input = h('input', { type: 'checkbox', checked: value }) as HTMLInputElement;
    input.onchange = () => onChange(input.checked);
    return h('label', { class: 'field row' }, input, label);
  }

  /** 保存できる条件：モデルあり・名前あり・エラーなし・（アニメがあれば）3種割当＋歩行テスト済み */
  private saveBlockers(): string[] {
    const d = this.draft;
    const out: string[] = [];
    if (!d.container) out.push('GLBを読み込んでください');
    if (!d.name.trim()) out.push('名前を入力してください');
    if (d.issues.some((i) => i.level === 'error')) out.push('エラーを解消してください');
    if (d.analysis?.animationNames.length) {
      const missing = REQUIRED_ANIMS.filter((s) => !d.animationMap[s]);
      if (missing.length) out.push(`${missing.map((m) => ANIM_LABELS[m]).join('・')}を割り当ててください`);
      else if (!d.testPassed) out.push('「歩かせてみる」で動きを確認してください');
    }
    return out;
  }

  private refreshSave() {
    const btn = this.side.querySelector('[data-role=save]') as HTMLButtonElement | null;
    const hint = this.side.querySelector('[data-role=save-hint]') as HTMLElement | null;
    if (!btn || !hint) return;
    const blockers = this.saveBlockers();
    btn.disabled = blockers.length > 0;
    hint.textContent = blockers.length ? `※ ${blockers[0]}` : '✔ 登録できます';
  }

  // ---------- 読み込み ----------
  private async loadSample(url: string, name: string, role: CharacterRole) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      this.draft = emptyDraft();
      this.draft.name = name;
      this.draft.role = role;
      await this.loadFile(blob, url.split('/').pop()!);
    } catch (e) {
      this.draft.issues = [{ level: 'error', message: `サンプルを読み込めませんでした（${String(e)}）` }];
      void this.renderSide();
    }
  }

  private async loadFile(blob: Blob, fileName: string) {
    const d = this.draft;
    this.stopTest();
    this.disposeModel();
    d.issues = await precheckGlb(blob, fileName);
    d.fileName = fileName;
    d.analysis = null;
    d.testPassed = false;
    if (!d.name) d.name = fileName.replace(/\.[^.]+$/, '').slice(0, 16);
    if (d.issues.some((i) => i.level === 'error')) { d.blob = null; void this.renderSide(); return; }
    this.loading = true;
    void this.renderSide();
    try {
      const container = await loadContainerFromBlob(blob, this.scene);
      d.container = container;
      d.blob = blob;
      d.blobIsNew = true;
      d.analysis = analyzeContainer(container);
      d.issues.push(...d.analysis.issues);
      if (!d.editingId || !Object.keys(d.animationMap).length) d.animationMap = { ...d.analysis.suggestions };
      this.measure();
      // 極端なスケールのモデルは自動で1.7mに合わせる
      if (d.rawHeight > 0 && (d.rawHeight < 0.3 || d.rawHeight > 5)) {
        d.transform.scale = +(1.7 / d.rawHeight).toFixed(3);
        d.issues.push({ level: 'info', message: `モデルの身長が${d.rawHeight.toFixed(2)}で極端なため、1.7mに自動調整しました。` });
      }
      if (!d.editingId) d.transform.yOffset = +(-d.rawMinY * d.transform.scale).toFixed(3);
      this.rebuildInstance();
      this.viewFront();
    } catch (e) {
      console.error(e);
      d.container = null;
      d.issues.push({ level: 'error', message: `読み込みに失敗しました：${(e as Error)?.message ?? e}` });
    } finally {
      this.loading = false;
      void this.renderSide();
    }
  }

  /** 素のサイズ（Scale=1）での身長と足元 */
  private measure() {
    const d = this.draft;
    if (!d.container) return;
    const probe = CharacterInstance.create(this.scene, this.toDefinition(), d.container, { placeholderColor: Color3.Gray(), name: 'probe' });
    probe.applyTransform({ transform: { scale: 1, rotationY: 0, yOffset: 0 } });
    probe.root.computeWorldMatrix(true);
    const { min, max } = probe.root.getHierarchyBoundingVectors(true);
    d.rawHeight = Math.max(0.01, max.y - min.y);
    d.rawMinY = min.y;
    probe.dispose();
  }

  private toDefinition(): CharacterDefinition {
    const d = this.draft;
    const now = new Date().toISOString();
    const a = d.analysis;
    return {
      id: d.editingId ?? `chr-${Date.now().toString(36)}`,
      name: d.name.trim() || '名無し',
      role: d.role,
      modelAssetId: d.assetId ?? `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      fileName: d.fileName,
      fileSize: d.blob?.size ?? 0,
      animationMap: { ...d.animationMap },
      transform: { ...d.transform },
      locomotion: { ...d.locomotion },
      stripRootMotion: d.stripRootMotion,
      stats: { triangles: a?.triangles ?? 0, bones: a?.bones ?? 0, maxTextureSize: a?.maxTextureSize ?? 0, animationCount: a?.animationNames.length ?? 0, height: d.rawHeight },
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };
  }

  private rebuildInstance() {
    const d = this.draft;
    this.instance?.dispose();
    this.instance = null;
    if (!d.container) return;
    this.instance = CharacterInstance.create(this.scene, this.toDefinition(), d.container, { placeholderColor: Color3.Gray(), name: 'preview' });
    this.applyTransform();
    if (this.freeAnim) this.playFree(this.freeAnim);
  }

  private applyTransform() {
    this.instance?.applyTransform({ transform: this.draft.transform });
    this.camera.target.y = Math.max(0.4, (this.draft.rawHeight * this.draft.transform.scale) / 2);
  }

  private playFree(name: string) {
    if (!this.instance?.anim || !this.draft.analysis) return;
    this.stopTest();
    this.freeAnim = name;
    // 任意のAnimationGroupを直接再生するため、一時的に idle スロットに差し替えたコントローラを作る
    const def = this.toDefinition();
    def.animationMap = { idle: name };
    this.instance.dispose();
    this.instance = CharacterInstance.create(this.scene, def, this.draft.container, { placeholderColor: Color3.Gray(), name: 'preview' });
    this.applyTransform();
    this.nowLabel.textContent = `再生中：${name}`;
  }

  // ---------- 歩かせてみる ----------
  private startTest() {
    if (!this.draft.container) return;
    this.freeAnim = null;
    this.rebuildInstance();
    this.test = { t: 0, angle: 0 };
    this.camera.radius = Math.max(this.camera.radius, 7);
    void this.renderSide();
  }

  private stopTest() {
    this.test = null;
    this.instance?.setPosition(0, 0);
    this.instance?.setFacing(0);
  }

  private tick(dt: number) {
    const inst = this.instance;
    if (!inst) return;
    if (this.test) {
      this.test.t += dt;
      let acc = 0;
      let phase = TEST_SEQUENCE[TEST_SEQUENCE.length - 1];
      for (const p of TEST_SEQUENCE) { acc += p.seconds; if (this.test.t < acc) { phase = p; break; } }
      const total = TEST_SEQUENCE.reduce((s, p) => s + p.seconds, 0);
      const speed = phase.state === 'walk' ? this.draft.locomotion.walkSpeed : phase.state === 'run' ? this.draft.locomotion.runSpeed : 0;
      const radius = 2.4;
      this.test.angle += (speed / radius) * dt;
      const x = Math.cos(this.test.angle) * radius - radius, z = Math.sin(this.test.angle) * radius;
      inst.setPosition(x, z);
      if (speed > 0) inst.setFacing(Math.atan2(-Math.sin(this.test.angle), Math.cos(this.test.angle)));
      inst.setLocomotion(speed);
      this.camera.target.x = x * 0.5;
      this.camera.target.z = z * 0.5;
      this.nowLabel.textContent = `テスト中：${TEST_SEQUENCE.map((p) => (p === phase ? `【${p.label}】` : p.label)).join(' → ')}`;
      if (this.test.t >= total) {
        this.test = null;
        this.draft.testPassed = true;
        inst.setPosition(0, 0);
        this.camera.target.x = 0;
        this.camera.target.z = 0;
        this.nowLabel.textContent = '✔ テスト完了。動きに問題がなければ登録できます。';
        void this.renderSide();
      }
    } else if (!this.freeAnim) {
      inst.setLocomotion(0);
    }
    inst.update(dt);
  }

  // ---------- 保存・編集・削除 ----------
  private async save() {
    const d = this.draft;
    if (this.saveBlockers().length) return;
    const def = this.toDefinition();
    const existing = d.editingId ? await CharacterRepository.get(d.editingId) : undefined;
    if (existing) def.createdAt = existing.createdAt;
    try {
      await CharacterRepository.save(def, d.blobIsNew ? d.blob : null);
      this.changed = true;
      if (d.useAsActive && (def.role === 'hero' || def.role === 'partner')) this.cb.setActive(def.role, def.id);
      this.nowLabel.textContent = `「${def.name}」を保存しました`;
      this.stopTest();
      this.disposeModel();
      this.draft = emptyDraft();
      void this.renderSide();
    } catch (e) {
      d.issues = [...d.issues.filter((i) => !i.message.startsWith('保存')), { level: 'error', message: (e as Error).message }];
      void this.renderSide();
    }
  }

  private async edit(c: CharacterDefinition) {
    const blob = await CharacterRepository.getModelBlob(c.modelAssetId);
    this.draft = {
      ...emptyDraft(),
      editingId: c.id, name: c.name, role: c.role, assetId: c.modelAssetId,
      animationMap: { ...c.animationMap }, transform: { ...c.transform }, locomotion: { ...c.locomotion },
      stripRootMotion: c.stripRootMotion, useAsActive: false,
    };
    if (!blob) {
      this.draft.issues = [{ level: 'error', message: 'モデルデータが見つかりません（削除された可能性があります）。GLBを選び直してください。' }];
      void this.renderSide();
      return;
    }
    await this.loadFile(blob, c.fileName);
    this.draft.blobIsNew = false;
  }

  private async remove(c: CharacterDefinition) {
    if (!confirm(`「${c.name}」を削除しますか？`)) return;
    await CharacterRepository.remove(c);
    const a = this.cb.activeIds();
    if (a.hero === c.id) this.cb.setActive('hero', null);
    if (a.partner === c.id) this.cb.setActive('partner', null);
    for (const [npc, id] of Object.entries(a.npcs)) if (id === c.id) this.cb.setNpcAppearance(npc, null);
    this.changed = true;
    void this.renderSide();
  }

  private disposeModel() {
    this.instance?.dispose();
    this.instance = null;
    this.freeAnim = null;
    this.draft.container?.dispose();
    this.draft.container = null;
  }
}
