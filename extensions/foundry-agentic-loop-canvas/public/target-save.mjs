// Saves the SDD target (environment, subscription, location) one request at a time. Edits are merged and debounced;
// flush() saves whatever is pending now and resolves once every save so far has settled, so a send never carries a
// stale target. A failed save restores the server's target unless a newer edit is already on its way.
// Timers are wrapped because browsers reject setTimeout and clearTimeout called as methods of another object.
export class TargetSaver {
    constructor({ save, restore = async () => {}, delay = 400, onChange = () => {}, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
        Object.assign(this, { save, restore, delay, onChange, setTimer, clearTimer });
        this.pending = null;
        this.timer = null;
        this.inflight = 0;
        this.chain = Promise.resolve({ ok: true });
    }

    get saving() { return this.pending !== null || this.inflight > 0; }

    schedule(input) {
        this.pending = { ...this.pending, ...input };
        this.clearTimer(this.timer);
        this.timer = this.setTimer(() => { this.flush(); }, this.delay);
        this.onChange(true);
    }

    // Drops a field still waiting to be saved, such as an environment name that became invalid.
    discard(key) {
        if (!this.pending || !(key in this.pending)) return;
        const { [key]: _, ...rest } = this.pending;
        this.pending = Object.keys(rest).length ? rest : null;
        if (!this.pending) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
        this.onChange(this.saving);
    }

    flush() {
        this.clearTimer(this.timer);
        this.timer = null;
        // An earlier failure was already reported and the controls restored, so it no longer blocks.
        if (!this.pending && !this.inflight) return Promise.resolve({ ok: true });
        if (this.pending) {
            const input = this.pending;
            this.pending = null;
            this.inflight++;
            this.chain = this.chain.then(() => this.#run(input));
        }
        return this.chain;
    }

    async #run(input) {
        let result;
        try {
            await this.save(input);
            result = { ok: true };
        } catch (error) {
            result = { ok: false, error };
            if (!this.pending && this.inflight === 1) {
                try { await this.restore(error); } catch { /* The next poll or save brings the target back in line. */ }
            }
        }
        this.inflight--;
        this.onChange(this.saving);
        return result;
    }
}
