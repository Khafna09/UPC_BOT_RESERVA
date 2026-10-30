const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { selectReservationStart, selectReservationEnd, isReservationEndReady } = require('../reservation-selection');

let browser;
let page;
const preferences = ['eid_130550', 'eid_134269', 'eid_129345', 'eid_130569', 'eid_134287'];
// Mismo identificador, capacidad y estructura de filas que el HTML público UPC.
const rooms = [
    { id: 'eid_134270', capacity: 6 }, // 16: primero en el criterio anterior
    { id: 'eid_134262', capacity: 5 }, // 01: nunca debe entrar en el respaldo
    { id: 'eid_130555', capacity: 4 }, // 18: nunca debe entrar en el respaldo
    { id: preferences[1], capacity: 5 },
    { id: preferences[0], capacity: 5 },
    { id: preferences[2], capacity: 5 },
    { id: preferences[3], capacity: 4 },
    { id: preferences[4], capacity: 6 },
    { id: 'eid_134275', capacity: 6 }, // 17: segundo respaldo
];

before(async () => {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.emulateTimezone('America/Lima');
});

after(async () => { await browser?.close(); });

async function loadGrid(available = {}, omitted = []) {
    await page.setContent('<table style="border-collapse:collapse"><tr id="slots"></tr></table><table><tbody id="lanes"></tbody></table>');
    await page.evaluate(({ rooms, available, omitted }) => {
        window.resources = rooms.filter(room => !omitted.includes(room.id));
        window.clicked = [];
        window.endChanges = 0;
        const slots = document.querySelector('#slots');
        for (let hour = 0; hour < 24; hour++) {
            slots.insertAdjacentHTML('beforeend', `<td class="fc-timeline-slot" data-date="2026-10-31T${String(hour).padStart(2, '0')}:00:00" style="min-width:50px;padding:0">${hour}</td>`);
        }
        const offsets = Array.from(slots.children, td => td.offsetLeft);
        const events = [];
        for (const room of window.resources) {
            const row = document.createElement('tr');
            const lane = document.createElement('td');
            lane.className = 'fc-timeline-lane fc-resource';
            lane.dataset.resourceId = room.id;
            lane.style.cssText = 'position:relative;height:40px;min-width:1200px';
            for (let hour = 18; hour < 24; hour++) {
                const free = (available[room.id] || []).includes(hour);
                lane.insertAdjacentHTML('beforeend', `<div class="fc-timeline-event-harness" style="position:absolute;left:${offsets[hour]}px"><a href="#" class="${free ? 's-lc-eq-avail' : 's-lc-eq-unavailable'}">${hour}</a></div>`);
                const start = new Date(2026, 9, 31, hour);
                const end = new Date(2026, 9, 31, hour + 1);
                events.unshift({ start, end, extendedProps: { status: free ? 0 : 1 }, getResources: () => [room] });
            }
            row.append(lane);
            document.querySelector('#lanes').append(row);
        }
        window.timelineInstance = { getEvents: () => events };
        document.addEventListener('click', event => {
            event.preventDefault();
            const lane = event.target.closest('.fc-timeline-lane');
            if (lane) window.clicked.push({ resourceId: lane.dataset.resourceId, hour: event.target.textContent });
        });
    }, { rooms, available, omitted });
}

async function expectSelection(resourceId, preferred, start = '20:00', end = '22:00') {
    const result = await page.evaluate(selectReservationStart, start, end);
    if (!resourceId) {
        assert.equal(result, null);
        assert.deepEqual(await page.evaluate(() => window.clicked), []);
        return;
    }
    assert.equal(result.resourceId, resourceId);
    assert.equal(result.preferred, preferred);
    assert.ok(Number.isFinite(result.end));
    assert.deepEqual(await page.evaluate(() => window.clicked), [{ resourceId, hour: String(Number(start.slice(0, 2))) }]);
}

test('respeta los cinco niveles de prioridad aunque el DOM tenga otro orden', async t => {
    for (let rank = 0; rank < preferences.length; rank++) {
        await t.test(`preferencia ${rank + 1}`, async () => {
            const available = Object.fromEntries(rooms.map(room => [room.id, [20, 21]]));
            // Las preferencias anteriores tienen inicio libre pero duración insuficiente.
            for (const id of preferences.slice(0, rank)) available[id] = [20];
            await loadGrid(available);
            await expectSelection(preferences[rank], true);
        });
    }
});

test('sin preferencias completas, conserva el primer cubículo de 6 personas', async () => {
    await loadGrid({ eid_134270: [20, 21], eid_134275: [20, 21], eid_134262: [20, 21], eid_130555: [20, 21] });
    await expectSelection('eid_134270', false);
});

test('el respaldo también debe cubrir todo el intervalo', async () => {
    await loadGrid({ eid_134270: [20], eid_134275: [20, 21] });
    await expectSelection('eid_134275', false);
});

test('si faltan filas preferidas, continúa con las preferencias presentes', async () => {
    await loadGrid({ [preferences[3]]: [20, 21], eid_134270: [20, 21] }, preferences.slice(0, 3));
    await expectSelection(preferences[3], true);
});

test('no usa otros cubículos de 4 o 5 personas como respaldo', async () => {
    await loadGrid({ eid_134262: [20, 21], eid_130555: [20, 21] });
    await expectSelection(null);
});

test('rechaza huecos intermedios y no pulsa bloques de otra hora', async () => {
    await loadGrid({ [preferences[0]]: [20, 22], [preferences[1]]: [19, 21, 22] });
    await expectSelection(null, undefined, '20:00', '23:00');
});

test('permite que el bloque que comienza en HORA_FIN esté ocupado', async () => {
    await loadGrid({ [preferences[0]]: [20, 21] });
    await expectSelection(preferences[0], true);
});

test('admite medianoche como final del día visible', async () => {
    await loadGrid({ [preferences[0]]: [23] });
    await expectSelection(preferences[0], true, '23:00', '00:00');
});

test('no pulsa nada si falta la columna de inicio o el horario es inválido', async () => {
    for (const [start, end] of [['25:00', '22:00'], ['20:00', ''], ['20:00', '19:00'], ['20:00', '20:00']]) {
        await loadGrid({ [preferences[0]]: [20, 21] });
        await expectSelection(null, undefined, start, end);
    }
});

test('no pulsa un bloque si su coordenada o su clase difiere de los datos disponibles', async () => {
    await loadGrid({ [preferences[0]]: [20, 21], [preferences[1]]: [20, 21] });
    await page.evaluate(id => {
        for (const harness of document.querySelectorAll(`[data-resource-id="${id}"] .fc-timeline-event-harness`)) harness.style.left = 'auto';
    }, preferences[0]);
    await expectSelection(preferences[1], true);
});

test('la hora final exige fecha y hora exactas y confirmación de la actualización AJAX', async () => {
    await page.setContent('<select class="b-end-date"><option value="2026-10-31 21:00:00">21:00</option><option value="2026-10-31 22:00:00">22:00</option></select><button id="submit_times">Reservar</button>');
    const expectedEnd = await page.evaluate(() => {
        window.pendingRoomBookings = [{ end: new Date('2026-10-31T21:00:00') }];
        document.querySelector('.b-end-date').addEventListener('change', () => window.endChanges++);
        return new Date('2026-10-31T22:00:00').getTime();
    });
    assert.equal(await page.evaluate(selectReservationEnd, expectedEnd), true);
    assert.equal(await page.evaluate(isReservationEndReady, expectedEnd), false);
    assert.equal(await page.evaluate(() => window.endChanges), 1);
    await page.evaluate(end => { window.pendingRoomBookings[0].end = new Date(end); }, expectedEnd);
    assert.equal(await page.evaluate(isReservationEndReady, expectedEnd), true);
    assert.equal(await page.evaluate(selectReservationEnd, expectedEnd), true);
    assert.equal(await page.evaluate(() => window.endChanges), 1);
    assert.equal(await page.evaluate(selectReservationEnd, expectedEnd + 86400000), false);
    await page.evaluate(() => { document.querySelector('#submit_times').disabled = true; });
    assert.equal(await page.evaluate(isReservationEndReady, expectedEnd), false);
});

test('si no existe la hora final solicitada, no cambia ni acepta una reserva más corta', async () => {
    await page.setContent('<select class="b-end-date"><option value="2026-10-31 21:00:00">21:00</option></select><button id="submit_times">Reservar</button>');
    const expectedEnd = await page.evaluate(() => {
        window.pendingRoomBookings = [{ end: new Date('2026-10-31T21:00:00') }];
        return new Date('2026-10-31T22:00:00').getTime();
    });
    assert.equal(await page.evaluate(selectReservationEnd, expectedEnd), false);
    assert.equal(await page.evaluate(isReservationEndReady, expectedEnd), false);
    assert.equal(await page.$eval('.b-end-date', select => select.value), '2026-10-31 21:00:00');
});
