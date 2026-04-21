const NETWORK_LABELS = {
    WesternOrienLightningRailNetwork: 'Western Orien Lightning Rail',
    EasternLightningRailNetwork: 'Eastern Lightning Rail'
};

let networks = {};

const startSelect = document.getElementById('start');
const endSelect = document.getElementById('end');
const routeForm = document.getElementById('route-form');
const submitButton = routeForm.querySelector('button');
const resultContainer = document.getElementById('result');

const milesFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const goldFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

fetch('nodes.json')
    .then(response => {
        if (!response.ok) {
            throw new Error(`Network response was not ok (${response.status})`);
        }
        return response.json();
    })
    .then(data => {
        networks = data;
        populateStartNodes();
    })
    .catch(error => {
        console.error('Error fetching node data:', error);
        disableForm();
        renderErrorState('We could not load the Lightning Rail network data. Please refresh and try again.');
    });

startSelect.addEventListener('change', () => {
    populateEndNodes();
    updateButtonState();
});

endSelect.addEventListener('change', updateButtonState);

routeForm.addEventListener('submit', event => {
    event.preventDefault();
    findShortestPath();
});

function populateStartNodes() {
    const aggregatedNodes = [];

    Object.entries(networks).forEach(([networkKey, nodes]) => {
        Object.keys(nodes).forEach(city => {
            aggregatedNodes.push({ city, networkKey });
        });
    });

    aggregatedNodes.sort((a, b) => a.city.localeCompare(b.city));

    startSelect.innerHTML = '<option value="" disabled selected hidden>Select departure</option>';
    const fragment = document.createDocumentFragment();

    aggregatedNodes.forEach(({ city, networkKey }) => {
        const option = document.createElement('option');
        option.value = city;
        option.dataset.network = networkKey;
        option.textContent = `${city} · ${NETWORK_LABELS[networkKey] || networkKey}`;
        fragment.appendChild(option);
    });

    startSelect.appendChild(fragment);
    startSelect.disabled = false;
}

function populateEndNodes() {
    const selectedOption = startSelect.options[startSelect.selectedIndex];
    const selectedCity = startSelect.value;
    const selectedNetwork = selectedOption ? selectedOption.dataset.network : null;

    endSelect.innerHTML = '<option value="" disabled selected hidden>Select destination</option>';
    endSelect.value = '';
    endSelect.disabled = !selectedNetwork;

    if (!selectedNetwork) {
        return;
    }

    const nodes = networks[selectedNetwork] || {};
    const fragment = document.createDocumentFragment();

    Object.keys(nodes)
        .filter(city => city !== selectedCity)
        .sort((a, b) => a.localeCompare(b))
        .forEach(city => {
            const option = document.createElement('option');
            option.value = city;
            option.dataset.network = selectedNetwork;
            option.textContent = `${city} · ${NETWORK_LABELS[selectedNetwork] || selectedNetwork}`;
            fragment.appendChild(option);
        });

    endSelect.appendChild(fragment);
}

function updateButtonState() {
    const isReady = Boolean(startSelect.value && endSelect.value);
    submitButton.disabled = !isReady;
}

function findShortestPath() {
    const startOption = startSelect.options[startSelect.selectedIndex];
    const endOption = endSelect.options[endSelect.selectedIndex];

    if (!startOption || !endOption) {
        return;
    }

    const start = startOption.value;
    const end = endOption.value;
    const networkKey = startOption.dataset.network;

    if (!networkKey || !networks[networkKey]) {
        renderNoRoute(`We could not determine the network for ${start}.`);
        return;
    }

    const graph = networks[networkKey];
    const result = dijkstra(graph, start, end);

    if (!result.path.length || !Number.isFinite(result.time)) {
        renderNoRoute(`No available Lightning Rail route between ${start} and ${end}.`);
        return;
    }

    const routeDetails = buildRouteDetails(graph, result.path);

    if (!routeDetails.legs.length) {
        renderNoRoute('We could not assemble the leg details for this journey.');
        return;
    }

    const totals = {
        firstClass: routeDetails.totalTime * 15,
        standard: routeDetails.totalTime * 6,
        steerage: routeDetails.totalTime * 0.9,
        cargo: routeDetails.totalTime * 1.5
    };

    renderResult({
        route: result.path,
        totalTime: routeDetails.totalTime,
        totalDistance: routeDetails.totalDistance,
        totals,
        legs: routeDetails.legs,
        networkLabel: NETWORK_LABELS[networkKey] || networkKey
    });
}

function dijkstra(graph, start, end) {
    const queue = [{ node: start, time: 0, path: [] }];
    const visited = new Set();
    const minTime = { [start]: 0 };

    while (queue.length > 0) {
        queue.sort((a, b) => a.time - b.time);
        const { node: currentNode, time: currentTime, path } = queue.shift();

        if (visited.has(currentNode)) continue;

        const newPath = path.concat(currentNode);
        visited.add(currentNode);

        if (currentNode === end) return { time: currentTime, path: newPath };

        for (const [neighbor, travelTime] of graph[currentNode] || []) {
            if (!visited.has(neighbor)) {
                const nextTime = currentTime + travelTime;
                if (minTime[neighbor] === undefined || nextTime < minTime[neighbor]) {
                    minTime[neighbor] = nextTime;
                    queue.push({ node: neighbor, time: nextTime, path: newPath });
                }
            }
        }
    }

    return { time: Infinity, path: [] };
}

function buildRouteDetails(graph, path) {
    return path.reduce((details, node, index) => {
        if (index === 0) {
            return details;
        }

        const previous = path[index - 1];
        const connection = (graph[previous] || []).find(([neighbor]) => neighbor === node);

        if (!connection) {
            return details;
        }

        const travelTime = connection[1];
        const distance = travelTime * 30;

        details.totalTime += travelTime;
        details.totalDistance += distance;

        details.legs.push({
            from: previous,
            to: node,
            travelTime,
            distance,
            firstClass: travelTime * 15,
            standard: travelTime * 6,
            steerage: travelTime * 0.9,
            cargo: travelTime * 1.5
        });

        return details;
    }, { totalTime: 0, totalDistance: 0, legs: [] });
}

function renderResult({ route, totalTime, totalDistance, totals, legs, networkLabel }) {
    resultContainer.classList.remove('result--empty');
    resultContainer.innerHTML = `
        <div class="result__summary">
            <div class="result__heading">
                <span class="result__eyebrow">${networkLabel}</span>
                <h3>${route[0]} <span aria-hidden="true">→</span> ${route[route.length - 1]}</h3>
                <p>${route.length - 1} legs • ${formatMiles(totalDistance)} miles total</p>
                <p class="result__path" aria-label="Route">${route.join(' → ')}</p>
            </div>
            <dl class="metrics">
                <div class="metrics__item">
                    <dt>Total time</dt>
                    <dd>${formatHours(totalTime)}</dd>
                </div>
                <div class="metrics__item">
                    <dt>Total distance</dt>
                    <dd>${formatMiles(totalDistance)} miles</dd>
                </div>
                <div class="metrics__item">
                    <dt>First class</dt>
                    <dd>${formatGold(totals.firstClass)} gp</dd>
                </div>
                <div class="metrics__item">
                    <dt>Standard fare</dt>
                    <dd>${formatGold(totals.standard)} gp</dd>
                </div>
            </dl>
        </div>
        <section class="fare-grid" aria-label="Fare comparison">
            <h4>Fare comparison</h4>
            <div class="fare-grid__items">
                ${renderFareCard('First class', totals.firstClass, 'Private cabins and fine dining for dignitaries.')}
                ${renderFareCard('Standard fare', totals.standard, 'Comfortable berths aligned with House Orien hospitality.')}
                ${renderFareCard('Steerage', totals.steerage, 'Budget option for short hops and adventuring parties.')}
                ${renderFareCard('Cargo (per 100 lbs)', totals.cargo, 'Ideal for couriers, guild shipments, and trade goods.')}
            </div>
        </section>
        <section class="legs" aria-label="Leg-by-leg breakdown">
            <div class="legs__header">
                <h4>Leg-by-leg details</h4>
                <p>Review duration, distance, and fares for each connection.</p>
            </div>
            <div class="legs__table-wrapper">
                <table class="legs-table">
                    <thead>
                        <tr>
                            <th scope="col">Leg</th>
                            <th scope="col">Time</th>
                            <th scope="col">Distance</th>
                            <th scope="col">First</th>
                            <th scope="col">Standard</th>
                            <th scope="col">Steerage</th>
                            <th scope="col">Cargo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${legs.map((leg, index) => renderLegRow(leg, index)).join('')}
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

function renderFareCard(label, value, description) {
    return `
        <article class="fare-card">
            <span class="fare-card__label">${label}</span>
            <span class="fare-card__value">${formatGold(value)} gp</span>
            <span class="fare-card__meta">${description}</span>
        </article>
    `;
}

function renderLegRow(leg, index) {
    return `
        <tr>
            <td>${index + 1}. ${leg.from} → ${leg.to}</td>
            <td>${formatHours(leg.travelTime)}</td>
            <td>${formatMiles(leg.distance)} miles</td>
            <td>${formatGold(leg.firstClass)} gp</td>
            <td>${formatGold(leg.standard)} gp</td>
            <td>${formatGold(leg.steerage)} gp</td>
            <td>${formatGold(leg.cargo)} gp</td>
        </tr>
    `;
}

function renderNoRoute(message) {
    resultContainer.classList.remove('result--empty');
    resultContainer.innerHTML = `
        <div class="empty-state">
            <h3>Route unavailable</h3>
            <p>${message}</p>
        </div>
    `;
}

function renderErrorState(message) {
    resultContainer.classList.remove('result--empty');
    resultContainer.innerHTML = `
        <div class="empty-state">
            <h3>Something went wrong</h3>
            <p>${message}</p>
        </div>
    `;
}

function disableForm() {
    startSelect.disabled = true;
    endSelect.disabled = true;
    submitButton.disabled = true;
}

function formatHours(hours) {
    if (!Number.isFinite(hours)) {
        return 'N/A';
    }

    if (hours <= 0) {
        return '0 hrs';
    }

    if (hours < 1) {
        const minutes = Math.round(hours * 60);
        return `${minutes} min${minutes === 1 ? '' : 's'}`;
    }

    const days = Math.floor(hours / 24);
    const remainingHoursRaw = hours % 24;
    const remainingHours = Math.round(remainingHoursRaw * 10) / 10;

    const segments = [];

    if (days > 0) {
        segments.push(`${days} day${days === 1 ? '' : 's'}`);
    }

    if (remainingHours >= 0.1 || segments.length === 0) {
        const displayHours = trimTrailingZeros(remainingHours || 0);
        segments.push(`${displayHours} hr${displayHours === '1' ? '' : 's'}`);
    }

    return segments.join(' ');
}

function formatMiles(distance) {
    if (!Number.isFinite(distance)) {
        return '0';
    }

    return milesFormatter.format(Math.round(distance));
}

function formatGold(value) {
    if (!Number.isFinite(value)) {
        return '0.00';
    }

    return goldFormatter.format(value);
}

function trimTrailingZeros(value) {
    const fixed = value.toFixed(1);
    return fixed.endsWith('.0') ? String(Math.round(value)) : fixed;
}
