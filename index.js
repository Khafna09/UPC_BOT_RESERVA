require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const { selectReservationStart, selectReservationEnd, isReservationEndReady } = require('./reservation-selection');
puppeteer.use(StealthPlugin());

const randomDelay = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)));
const COOKIE_PATH = './cookies.json';

(async () => {
    console.log('Iniciando el bot de reserva automática...');

    // Sincronización con la ventana de tiempo objetivo (00:00:05)
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
    const target = new Date(now);

    if (now.getHours() === 23) {
        target.setDate(target.getDate() + 1);
    }
    target.setHours(0, 0, 5, 0);

    const waitTime = target.getTime() - now.getTime();

    if (waitTime > 0) {
        console.log(`Esperando el momento ideal... Hibernando por ${Math.round(waitTime / 1000)}s hasta el disparo...`);
        await new Promise(r => setTimeout(r, waitTime));
    } else {
        console.log(`Se pasó del tiempo. Ejecutando operación inmediata.`);
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--lang=es-PE,es'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.emulateTimezone('America/Lima');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-PE,es,en;q=0.9' });

    // Inyecta las cookies generadas y cargadas en las secret keys de github
    let cookies = null;
    if (process.env.SAVED_COOKIES) {
        cookies = JSON.parse(process.env.SAVED_COOKIES);
    } else if (fs.existsSync(COOKIE_PATH)) {
        cookies = JSON.parse(fs.readFileSync(COOKIE_PATH));
    }

    if (cookies && cookies.length > 0) {
        await page.setCookie(...cookies);
    } else {
        throw new Error("No se encontraron credenciales válidas. Ejecute generate-cookies.js primero o revise las cookies guardadas.");
    }

    try {
        console.log('[LOG] Accediendo a la plataforma...');
        // DOMContentLoaded es mucho más rápido que networkidle2
        // Vista pública de San Miguel, cubículos de todas las capacidades y pisos.
        // Evita navegar por filtros separados para cada preferencia.
        await page.goto('https://bibliotecareserva.upc.edu.pe/r/new/availability?lid=15560&gid=33848&zone=0&capacity=0', { waitUntil: 'domcontentloaded' });

        // Cambia al dia que sigue (el que apenas se va a habilitar)
        await page.waitForSelector('.fc-next-button', { visible: true });
        await page.click('.fc-next-button');
        // Reducido a 1 segundo: Suficiente para que la grilla cambie de estado
        await randomDelay(1000, 1500);

        // Selecciona el bloque de la hora objetivo (ej: 20:00) y el bloque de hora fin (ej: 22:00)
        const horaInicio = (process.env.HORA_INICIO || '').trim();
        const horaFin = (process.env.HORA_FIN || '').trim().toLowerCase();

        console.log(`[LOG] Buscando disponibilidad en la columna de las ${horaInicio}...`);
        await page.waitForSelector('.s-lc-eq-avail, .s-lc-eq-unavailable', { timeout: 15000 });

        const clickExitoso = await page.evaluate(selectReservationStart, horaInicio, horaFin);

        if (!clickExitoso) {
            throw new Error(`[ALERTA] No hay disponibilidad de cubículos para el intervalo completo ${horaInicio}–${horaFin} (formato HH:mm).`);
        }
        console.log(`[LOG] Cubículo seleccionado: ${clickExitoso.resourceId} (${clickExitoso.preferred ? 'preferencia' : 'respaldo de 6 personas'}).`);

        await page.waitForSelector('.b-end-date', { visible: true, timeout: 15000 });
        const finSeleccionado = await page.evaluate(selectReservationEnd, clickExitoso.end);
        if (!finSeleccionado) {
            throw new Error(`[ALERTA] La plataforma no permite terminar a las ${horaFin}; se cancela para evitar una reserva más corta.`);
        }

        // El cambio de duración es AJAX: continuar solo cuando el servidor lo confirme.
        await page.waitForFunction(isReservationEndReady, { timeout: 15000 }, clickExitoso.end);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { }),
            page.click('#submit_times')
        ]);

        // Validación de aprobación 2FA (Microsoft Authenticator)
        await page.waitForFunction(() => {
            const form = document.querySelector('#q18288');
            const btnTerms = document.querySelector('#terms_accept');
            const loginBtn = document.querySelector('#link-login');
            return form || btnTerms || loginBtn;
        }, { timeout: 20000 });

        const isLoginRequired = await page.evaluate(() => document.querySelector('#link-login') !== null);
        if (isLoginRequired) {
            throw new Error("Sesión rechazada. Las cookies han caducado o el proveedor bloqueó el acceso.");
        }

        const isTermsPage = await page.$('#terms_accept') !== null;
        if (isTermsPage) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { }),
                page.click('#terms_accept')
            ]);
        }

        // Validación de acceso a formulario final
        console.log('[LOG] Procesando payload final...');
        await page.waitForSelector('#q18288', { visible: true, timeout: 15000 });
        await page.select('#q18288', 'San Miguel');
        await page.select('#q18305', 'Pregrado');
        await page.select('#q18289', 'Ingeniería de Software');
        await page.type('#q19110', process.env.COMPANERO_NOMBRE);
        await page.type('#q19111', process.env.COMPANERO_CODIGO);

        await page.click('#btn-form-submit');

        await page.waitForFunction(() => {
            const errorEl = document.querySelector('.alert-danger');
            const isErrorVisible = errorEl !== null && errorEl.clientHeight > 0;
            const isSuccessText = document.body.innerText.includes('Detalles de la reserva');
            return isSuccessText || isErrorVisible;
        }, { timeout: 15000 }).catch(() => { });

        const isError = await page.evaluate(() => {
            const errorEl = document.querySelector('.alert-danger');
            // Verifica que el error no sea un contenedor oculto
            return errorEl !== null && errorEl.clientHeight > 0;
        });

        if (!isError) {
            console.log('\n Se reservó');
            await page.screenshot({ path: 'reserva-EXITO.png', fullPage: true });
        } else {
            console.log('\n No se pudo reservar. Es probable que el sistema haya rechazado la solicitud o que el bloque ya no esté disponible.');
            await page.screenshot({ path: 'reserva-FALLIDA.png', fullPage: true });
        }

    } catch (error) {
        console.error('\n[ERROR FATAL]', error.message);
        if (page) await page.screenshot({ path: 'debug-ERROR-FINAL.png', fullPage: true }).catch(() => { });
    } finally {
        await browser.close();
    }
})();
