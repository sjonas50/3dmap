/** On-screen joystick and buttons for tablets and phones. */
export class TouchControls {
  constructor(actions, force = false) {
    this.actions = actions;
    this.move = { x: 0, y: 0 };
    this.run = false;
    this.jump = false;
    this.enabled = false;
    // tablets and phones get the controls straight away; touch-screen laptops get them on their first real touch
    if (force || matchMedia('(pointer: coarse)').matches) this.enable();
    else {
      const first = (e) => {
        if (e.pointerType !== 'touch') return;
        removeEventListener('pointerdown', first, true);
        this.enable();
      };
      addEventListener('pointerdown', first, true);
    }
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    const actions = this.actions;
    document.body.classList.add('touch');
    const zone = document.createElement('div');
    zone.id = 'joyZone';
    zone.innerHTML = '<div id="joyBase"><div id="joyKnob"></div></div>';
    document.getElementById('hud').appendChild(zone);
    const base = zone.querySelector('#joyBase'), knob = zone.querySelector('#joyKnob');
    const R = 52;
    let id = null, cx = 0, cy = 0;
    const set = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.move.x = dx / R;
      this.move.y = -dy / R;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect();
      cx = e.clientX; cy = e.clientY;
      base.style.left = `${cx - r.left - 60}px`;
      base.style.top = `${cy - r.top - 60}px`;
      base.classList.add('on');
      set(e.clientX, e.clientY);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX, e.clientY); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.move.x = this.move.y = 0;
      knob.style.transform = '';
      base.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const bar = document.createElement('div');
    bar.id = 'touchBtns';
    // Jump and Run react the moment a finger lands; the others wait for a full tap, which is what lets
    // them start speech on iOS and stops the tap from also landing on whatever opens underneath
    const btn = (label, cls, onTap, instant = false) => {
      const b = document.createElement('button');
      b.className = 'tbtn ' + cls;
      b.innerHTML = label;
      if (instant) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onTap(b); });
      else {
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onTap(b); });
      }
      bar.appendChild(b);
      return b;
    };
    btn('🦘<span>Jump</span>', 'big', () => (this.jump = true), true);
    btn('🏃<span>Run</span>', '', (b) => { this.run = !this.run; b.classList.toggle('on', this.run); }, true);
    btn('🔊<span>Read</span>', '', () => actions.read());
    btn('🐝<span>Help</span>', '', () => actions.help());
    btn('🗺️<span>Map</span>', '', () => actions.map());
    this.useBtn = btn('✋<span>Use</span>', 'use', () => actions.use());
    this.useBtn.style.visibility = 'hidden';
    document.getElementById('hud').appendChild(bar);
  }

  /** The Use button only shows when there is something to use (zip line, balloon, a friend to talk to). */
  setUse(on, icon = '✋', label = 'Use') {
    if (!this.useBtn) return;
    this.useBtn.style.visibility = on ? 'visible' : 'hidden';
    const html = `${icon}<span>${label}</span>`;
    if (on && this.useBtn.innerHTML !== html) this.useBtn.innerHTML = html;
  }

  /** Returns and clears the jump tap. */
  takeJump() {
    const j = this.jump;
    this.jump = false;
    return j;
  }
}
