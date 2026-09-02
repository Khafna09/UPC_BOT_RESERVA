require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
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
        await page.goto('https://bibliotecareserva.upc.edu.pe/r/new', { waitUntil: 'domcontentloaded' });

        // Filtra a la sede de San Miguel, elije la opción de cubiculo y muestra de todas las áreas
        await page.waitForSelector('#s-lc-location', { visible: true });
        await page.select('#s-lc-location', '15560'); // San Miguel
        await page.select('#s-lc-group', '33848');   // Grupo
        await page.select('#s-lc-type', '3');        // Cubículo
        await page.click('#s-lc-go');

        // Cambia al dia que sigue (el que apenas se va a habilitar)
        await page.waitForSelector('.fc-next-button', { visible: true });
        await page.click('.fc-next-button');
        // Reducido a 1 segundo: Suficiente para que la grilla cambie de estado
        await randomDelay(1000, 1500);

        // Selecciona el bloque de la hora objetivo (ej: 20:00) y el bloque de hora fin (ej: 22:00)
        const horaInicio = (process.env.HORA_INICIO || '').trim();
        const horaFin = (process.env.HORA_FIN || '').trim().toLowerCase();

        console.log(`[LOG] Buscando disponibilidad en la columna de las ${horaInicio}...`);
        await page.waitForSelector('.s-lc-eq-avail, .s-lc-eq-unavail', { timeout: 15000 });

        const clickExitoso = await page.evaluate((horaBuscada) => {
            // Busca la columna de fondo que tiene la hora exacta en su atributo
            const bgSlots = Array.from(document.querySelectorAll('td.fc-timeline-slot[data-date]'));
            const targetSlot = bgSlots.find(td => td.getAttribute('data-date').endsWith(`T${horaBuscada}:00`));

            if (!targetSlot) return false; // La hora no existe en la tabla

            // Mide matemáticamente cuántos píxeles hay desde la izquierda (Ej: 1470px)
            const targetLeftOffset = targetSlot.offsetLeft;

            // Buscar todos los contenedores de los cubículos
            const harnesses = Array.from(document.querySelectorAll('.fc-timeline-event-harness'));
            
            for (let harness of harnesses) {
                // Extraer el valor de la izquierda para la selección
                const leftValue = parseInt(harness.style.left, 10);

                // Si la caja está alineada en la misma columna de píxeles
                if (Math.abs(leftValue - targetLeftOffset) <= 2) {
                    
                    // Verificamos si este recuadro específico es verde (disponible)
                    const botonVerde = harness.querySelector('a.s-lc-eq-avail');
                    if (botonVerde) {
                        botonVerde.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
                        botonVerde.click();
                        return true;
                    }
                }
            }
            // Si terminó de escanear la columna y no halló verdes, retorna false
            return false;
        }, horaInicio);

        if (!clickExitoso) {
            throw new Error(`[ALERTA] No hay disponibilidad de cubículos a las ${horaInicio}.`);
        }

        await randomDelay(500, 800);
        await page.evaluate((horaFinBuscada) => {
            const endSelect = document.querySelector('.b-end-date');
            if (endSelect) {
                for (let i = 0; i < endSelect.options.length; i++) {
                    const text = endSelect.options[i].text.toLowerCase();
                    if (text.includes(horaFinBuscada) || text.replace(/\s+/g, '').includes(horaFinBuscada.replace(/\s+/g, ''))) {
                        endSelect.selectedIndex = i;
                        endSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        break;
                    }
                }
            }
        }, horaFin);

        await randomDelay(500, 800);
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
