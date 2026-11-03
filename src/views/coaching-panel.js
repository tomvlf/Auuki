import { xf } from '../functions.js';
import { db } from '../db.js';
import { coachingService, coachingData } from '../coaching/service.js';
import { GOALS, localDay } from '../coaching/domain.js';
import { fileHandler } from '../file.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

class CoachingPanel extends HTMLElement {
    connectedCallback() {
        this.controller = new AbortController();
        const options = {signal: this.controller.signal};
        this.addEventListener('submit', event => this.submit(event), options);
        this.addEventListener('click', event => this.click(event), options);
        xf.sub('coaching:changed', () => this.render(), options);
        xf.sub('db:ftp', () => this.render(), options);
        xf.sub('coaching:error', message => { this.error = message; this.render(); }, options);
        this.render();
    }
    disconnectedCallback() { this.controller.abort(); }
    render() {
        try {
            const data = coachingData();
            if(!data) {
                this.innerHTML = `<p role="${this.error ? 'alert' : 'status'}">${escape(this.error || 'Loading coaching history...')}</p>`;
                return;
            }
            const profile = data.profile;
            const plan = data.plan;
            const state = data.snapshots.at(-1);
            const ftpChanged = plan?.status === 'active' && profile.ftp !== (db.ftp || null);
            this.innerHTML = `
                <h3>Adaptive cycling coach</h3>
                <p>Training decision support, not medical diagnosis or medical advice.
                   Recommendations are deterministic, conservative heuristics, not guarantees.
                   No injuries or medical conditions are inferred.</p>
                ${this.error ? `<p role="alert">${escape(this.error)}</p>` : ''}
                ${ftpChanged ? '<p role="alert">Your profile FTP has changed. Archive and regenerate this plan before starting its workouts.</p>' : ''}
                ${plan ? `<p>Revision ${plan.revision} (${escape(plan.status)}).
                    ${escape(plan.rationale)}</p>
                    <p>Data: ${escape(state?.sufficiency)}. ${escape(state?.readiness.reason)}
                    Load scale: ${escape(state?.loadSource)}.</p>
                    <details><summary>Phases, targets and warnings</summary>
                        ${plan.phases.map(p => `<p>${escape(p.startDate)} - ${escape(p.endDate)}:
                            ${escape(p.type)}. ${escape(p.rationale)}</p>`).join('')}
                        ${plan.weeks.map(w => `<p>${escape(w.startDate)}:
                            ${escape(w.rationale)} Scheduled: ${w.scheduledMinutes} minutes.</p>`).join('')}
                        ${plan.validationWarnings.map(w => `<p>${escape(w)}</p>`).join('')}
                        ${(state?.warnings || []).map(w => `<p>${escape(w)}</p>`).join('')}
                        ${plan.adaptations.slice(-5).map(a => `<p>${escape(a.timestamp)}:
                            ${escape(a.reasoning)}</p>`).join('')}
                    </details>` : ''}
                ${plan?.status === 'active' ? `
                    <button type="button" data-coach="review">Review missed sessions</button>
                    <button type="button" data-coach="recovery">Request easier future training</button>
                    <button type="button" data-coach="archive">Archive plan</button>
                    <p>Generated sessions appear in the calendar. No missed training is made up.</p>
                ` : this.setupForm(profile, data.goal)}
                ${profile ? `
                    <button type="button" data-coach="export">Export coaching history</button>
                    <details><summary>Import history or add a manual ride</summary>
                        <p>Import a JSON array in the documented normalized input format. Duration is
                        seconds; streams must be contiguous one-second samples. Existing Auuki
                        activity summaries are seeded when you create your first plan.</p>
                        <form data-coach-form="import"><label>Rides JSON
                            <textarea name="rides" required rows="5">[]</textarea></label>
                            <button type="submit">Import and adapt</button></form>
                    </details>
                    <details><summary>Post-ride feedback</summary>
                        <form data-coach-form="feedback">
                            <label>Ride <select name="activity" required>
                                ${[...data.activities].reverse().map(a => `<option value="${escape(a.id)}">
                                    ${escape(a.day)} (${Math.round(a.duration / 60)} min)</option>`).join('')}
                            </select></label>
                            <label>Session RPE (0-10)<input name="rpe" type="number" min="0" max="10" step="1"></label>
                            ${[['legFreshness', 'Leg freshness (1 low, 5 high)'], ['sleepQuality', 'Sleep (1 poor, 5 good)'],
                                ['muscleSoreness', 'Soreness (1 low, 5 high)'], ['stress', 'Stress (1 low, 5 high)']]
                                .map(([name, text]) => `<label>${text}<input name="${name}" type="number" min="1" max="5" step="1"></label>`).join('')}
                            <button type="submit">Save feedback and adapt</button>
                        </form>
                    </details>` : ''}
            `;
        } catch(error) {
            console.error('Unable to render coaching:', error);
            this.innerHTML = `<p role="alert">Coaching unavailable: ${escape(error.message)}</p>`;
        }
    }
    setupForm(profile, goal) {
        const timeZone = profile?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const today = localDay(new Date().toISOString(), timeZone);
        return `<details ${profile ? '' : 'open'}><summary>Create a dated training plan</summary>
            <p>FTP (${escape(db.ftp)} W), body mass (${escape(db.weight)} kg) and units come from
            your existing profile. Set them there before planning. Create a profile first,
            import history, then generate a plan for history-based targets.</p>
            <form data-coach-form="setup">
                <label>Experience <select name="experience">${['beginner', 'intermediate', 'advanced']
                    .map(v => `<option ${v === (profile?.experience || 'beginner') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                <label>Typical hours/week<input type="number" name="hours" min="0.5" step="0.5"
                    value="${escape(profile?.typicalWeeklyHours || 3)}" required></label>
                <label>Maximum hours/week<input type="number" name="maxHours" min="0.5" step="0.5"
                    value="${escape(profile?.maxWeeklyHours || 4)}" required></label>
                <label>Time zone<input name="timeZone" value="${escape(timeZone)}" required></label>
                <label>Available weekday limits in minutes (0=Sun ... 6=Sat)
                    <textarea name="limits" required>${escape(JSON.stringify(profile?.maxSessionMinutes || {2: 60, 4: 60, 6: 120}))}</textarea></label>
                <label>Long-ride weekday (0-6)<input name="longDay" type="number" min="0" max="6"
                    value="${escape(profile?.longRideDay ?? 6)}" required></label>
                <details><summary>Optional equipment and heart-rate settings</summary>
                    <p>Optional JSON: maxHeartRate, thresholdHeartRate, restingHeartRate,
                    powerMeter, heartRateMonitor, smartTrainer, dayPreferences (indoor/outdoor/either).</p>
                    <textarea name="extras">{}</textarea>
                </details>
                <label>Goal name<input name="name" value="${escape(goal?.name || 'My cycling goal')}" required></label>
                <label>Goal type<select name="type">${Object.keys(GOALS).map(v =>
                    `<option value="${v}" ${v === goal?.type ? 'selected' : ''}>${v.replaceAll('_', ' ')}</option>`).join('')}</select></label>
                <label>Priority<select name="priority">${['A', 'B', 'C'].map(v =>
                    `<option ${v === goal?.priority ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                <label>Start date<input type="date" name="start" value="${today}" required></label>
                <label>Goal date<input type="date" name="date" value="${escape(goal?.date || '')}" required></label>
                <details><summary>Goal demands and targets</summary>
                    <p>Optional JSON: distanceKm, elevationM, expectedDurationMinutes, terrain,
                    targetPower, targetFTP, targetWKg, finishTimeMinutes, completionObjective.</p>
                    <textarea name="demands">${escape(JSON.stringify(goal ? Object.fromEntries(
                        ['distanceKm', 'elevationM', 'expectedDurationMinutes', 'terrain', 'targetPower',
                            'targetFTP', 'targetWKg', 'finishTimeMinutes', 'completionObjective']
                            .filter(k => goal[k] != null).map(k => [k, goal[k]])) : {}))}</textarea>
                </details>
                <button type="submit" name="operation" value="configure">Save profile and goal</button>
                <button type="submit" name="operation" value="generate">Save and generate plan</button>
            </form></details>`;
    }
    changed() {
        this.error = '';
        xf.dispatch('coaching:changed');
        this.render();
    }
    async submit(event) {
        const form = event.target.closest('[data-coach-form]');
        if(!form) return;
        event.preventDefault();
        try {
            const service = coachingService(), values = new FormData(form);
            if(form.dataset.coachForm === 'setup') {
                const limits = JSON.parse(values.get('limits'));
                const extras = JSON.parse(values.get('extras'));
                const profile = {
                    ...extras, id: service.data.profile?.id || 'local-athlete',
                    ftp: db.ftp || null, weight: db.weight, unitSystem: db.measurement,
                    experience: values.get('experience'), timeZone: values.get('timeZone'),
                    typicalWeeklyHours: Number(values.get('hours')), maxWeeklyHours: Number(values.get('maxHours')),
                    longRideDay: Number(values.get('longDay')), maxSessionMinutes: limits,
                    availableDays: Object.keys(limits).map(Number),
                };
                const goal = {...JSON.parse(values.get('demands')),
                    id: 'cycling-goal', name: values.get('name'), type: values.get('type'),
                    priority: values.get('priority'), date: values.get('date'), active: true};
                await service.configure(profile, goal);
                await service.importActivities(db.activity.filter(a => a.duration > 0).map(a => ({
                    id: a.id, duration: a.duration, source: 'auuki-summary',
                    start: new Date(a.timestamp - a.duration * 1000).toISOString(),
                })));
                if(event.submitter?.value === 'generate') await service.generate(values.get('start'));
            } else if(form.dataset.coachForm === 'import') {
                await service.importActivities(JSON.parse(values.get('rides')));
            } else {
                const feedback = Object.fromEntries(['rpe', 'legFreshness', 'sleepQuality', 'muscleSoreness', 'stress']
                    .filter(key => values.get(key) !== '').map(key => [key, Number(values.get(key))]));
                await service.updateFeedback(values.get('activity'), feedback);
            }
            this.changed();
        } catch(error) {
            console.error('Coaching action failed:', error);
            this.error = error.message || error.name || 'Coaching action failed.';
            this.render();
        }
    }
    async click(event) {
        const button = event.target.closest('[data-coach]');
        if(!button) return;
        try {
            const service = coachingService();
            if(button.dataset.coach === 'archive') await service.archive();
            if(button.dataset.coach === 'review') await service.advance();
            if(button.dataset.coach === 'recovery') await service.resolve({trigger: 'recovery'});
            if(button.dataset.coach === 'export') {
                fileHandler.download()(JSON.stringify(service.data, null, 2), 'auuki-coaching-history.json', 'application/json');
            }
            this.changed();
        } catch(error) {
            console.error('Coaching action failed:', error);
            this.error = error.message || error.name || 'Coaching action failed.';
            this.render();
        }
    }
}

customElements.define('coaching-panel', CoachingPanel);
export { CoachingPanel };
