/**
 * Se ejecuta dentro de page.evaluate, sin dependencias del proceso de Node.
 * Reutiliza la grilla cargada: no navega ni consulta disponibilidad otra vez.
 */
function selectReservationStart(horaBuscada, horaFinBuscada) {
    const targetSlot = Array.from(document.querySelectorAll('td.fc-timeline-slot[data-date]'))
        .find(td => td.getAttribute('data-date').endsWith(`T${horaBuscada}:00`));

    if (!targetSlot) return null;

    const endTime = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(horaFinBuscada);
    if (!endTime || !window.timelineInstance) return null;

    const start = new Date(targetSlot.getAttribute('data-date')).getTime();
    const endDate = new Date(start);
    endDate.setHours(Number(endTime[1]), Number(endTime[2]), 0, 0);
    // La medianoche puede ser el final del día visible.
    if (endTime[1] === '00' && endTime[2] === '00') endDate.setDate(endDate.getDate() + 1);
    const end = endDate.getTime();
    if (!Number.isFinite(start) || end <= start) return null;

    const availableByResource = new Map();
    for (const event of window.timelineInstance.getEvents()) {
        if (event.extendedProps.status !== 0 || !event.end) continue;
        const from = event.start.getTime();
        const to = event.end.getTime();
        if (from >= end || to <= start) continue;

        for (const resource of event.getResources()) {
            if (!availableByResource.has(resource.id)) availableByResource.set(resource.id, []);
            availableByResource.get(resource.id).push({ from, to });
        }
    }

    const coversInterval = resourceId => {
        const intervals = availableByResource.get(resourceId) || [];
        intervals.sort((a, b) => a.from - b.from);
        let coveredUntil = start;
        for (const interval of intervals) {
            if (interval.from > coveredUntil) return false;
            coveredUntil = Math.max(coveredUntil, interval.to);
            if (coveredUntil >= end) return true;
        }
        return false;
    };

    const targetLeftOffset = targetSlot.offsetLeft;
    // 10, 09 y 11: piso 2, 5 personas; 38 y 39: piso 3, 4 y 6 personas.
    const preferredResourceIds = ['eid_130550', 'eid_134269', 'eid_129345', 'eid_130569', 'eid_134287'];
    const resourcesById = new Map((window.resources || []).map(resource => [resource.id, resource]));
    const lanesById = new Map(Array.from(document.querySelectorAll('.fc-timeline-lane[data-resource-id]'))
        .map(lane => [lane.getAttribute('data-resource-id'), lane]));

    const clickIfAvailable = harness => {
        const leftValue = parseInt(harness.style.left, 10);
        if (Math.abs(leftValue - targetLeftOffset) > 2 || !Number.isFinite(leftValue)) return false;

        const button = harness.querySelector('a.s-lc-eq-avail');
        if (!button) return false;

        button.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        button.click();
        return true;
    };

    for (const resourceId of preferredResourceIds) {
        const lane = lanesById.get(resourceId);
        if (!lane || !coversInterval(resourceId)) continue;

        for (const harness of lane.querySelectorAll('.fc-timeline-event-harness')) {
            if (clickIfAvailable(harness)) {
                return { resourceId, resourceName: resourcesById.get(resourceId)?.title || resourceId, preferred: true, end };
            }
        }
    }

    // Respaldo original: primer bloque verde de la columna, solo de 6 personas.
    for (const harness of document.querySelectorAll('.fc-timeline-event-harness')) {
        const lane = harness.closest('.fc-timeline-lane[data-resource-id]');
        const resourceId = lane?.getAttribute('data-resource-id');
        if (resourcesById.get(resourceId)?.capacity !== 6 || !coversInterval(resourceId)) continue;

        if (clickIfAvailable(harness)) {
            return { resourceId, resourceName: resourcesById.get(resourceId)?.title || resourceId, preferred: false, end };
        }
    }

    return null;
}

function selectReservationEnd(expectedEnd) {
    const endSelect = document.querySelector('.b-end-date');
    if (!endSelect) return false;

    for (let i = 0; i < endSelect.options.length; i++) {
        const value = endSelect.options[i].value;
        if (new Date(value.replace(' ', 'T')).getTime() === expectedEnd) {
            if (endSelect.selectedIndex !== i) {
                endSelect.selectedIndex = i;
                endSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }
    }
    return false;
}

function isReservationEndReady(expectedEnd) {
    const bookings = window.pendingRoomBookings;
    const endSelect = document.querySelector('.b-end-date');
    const submit = document.querySelector('#submit_times');
    return bookings?.length === 1
        && Number(bookings[0].end) === expectedEnd
        && endSelect !== null
        && new Date(endSelect.value.replace(' ', 'T')).getTime() === expectedEnd
        && submit !== null && !submit.disabled;
}

module.exports = { selectReservationStart, selectReservationEnd, isReservationEndReady };
