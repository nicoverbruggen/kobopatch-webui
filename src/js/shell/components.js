export function banner({ kind, heading, paragraphs, link, hidden }) {
    const el = document.createElement('div');
    el.className = `banner banner--${kind || 'info'}`;
    if (hidden) el.hidden = true;

    if (heading) {
        const h = document.createElement('div');
        h.className = 'banner-heading';
        h.textContent = heading;
        el.appendChild(h);
    }

    for (const text of paragraphs || []) {
        const p = document.createElement('p');
        p.textContent = text;
        el.appendChild(p);
    }

    if (link) {
        const p = document.createElement('p');
        const a = document.createElement('a');
        a.href = link.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = link.label;
        p.append('See ', a, ' for details.');
        el.appendChild(p);
    }

    return el;
}

export function selectionCard({ value, name, title, desc, recommended, danger, disabled, label }) {
    const card = document.createElement('label');
    card.className = 'selection-card';
    if (recommended) card.classList.add('selection-card--recommended');
    if (danger) card.classList.add('selection-card--danger');
    if (disabled) card.classList.add('selection-card--disabled');

    const body = document.createElement('div');
    body.className = 'selection-card-body';

    const titleEl = document.createElement('div');
    titleEl.className = 'selection-card-title';
    titleEl.textContent = title;
    body.appendChild(titleEl);

    if (desc) {
        const descEl = document.createElement('div');
        descEl.className = 'selection-card-desc';
        descEl.textContent = desc;
        body.appendChild(descEl);
    }

    card.appendChild(body);

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    if (disabled) input.disabled = true;
    if (label) label.appendChild(input);
    else card.appendChild(input);

    return card;
}

export function stepActions({ backLabel, backId, nextLabel, nextId, nextDisabled }) {
    const wrap = document.createElement('div');
    wrap.className = 'step-actions';

    const left = document.createElement('div');
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.id = backId;
    backBtn.className = 'secondary';
    backBtn.textContent = backLabel || '\u2039 Back';
    left.appendChild(backBtn);
    wrap.appendChild(left);

    const right = document.createElement('div');
    right.className = 'step-actions-right';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.id = nextId;
    nextBtn.className = 'primary';
    nextBtn.textContent = nextLabel || 'Continue \u203A';
    if (nextDisabled) nextBtn.disabled = true;
    right.appendChild(nextBtn);
    wrap.appendChild(right);

    return wrap;
}
