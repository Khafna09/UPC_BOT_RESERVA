require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

const randomDelay = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)));
const COOKIE_PATH = './cookies.json';

/**
 * Script de extracción manual de cookies.
 * Maneja el flujo de login y espera la aprobación del 2FA (Microsoft Authenticator).
 */
(async () => {
    console.log('--- INICIANDO EXTRACCIÓN DE COOKIES Y SESIÓN ---');
    
    const browser = await puppeteer.launch({
        headless: false, 
        defaultViewport: null, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'] 
    });

    const page = await browser.newPage();

    try {
        console.log('[LOG] Navegando al sistema de bibliotecas...');
        await page.goto('https://bibliotecareserva.upc.edu.pe/r/new', { waitUntil: 'networkidle2' });

        console.log('[LOG] Iniciando el proceso de login...');
        const botonUPC = await page.waitForSelector('#link-login', { visible: true, timeout: 10000 });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            botonUPC.click()
        ]);

        console.log('[LOG] Ingresando credenciales...');
        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
        await page.type('input[type="email"]', process.env.UPC_CORREO, { delay: 50 });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}),
            page.click('input[type="submit"]')
        ]);

        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 10000 });
        await randomDelay(1000, 1500);
        await page.type('input[type="password"]', process.env.UPC_PASSWORD, { delay: 50 });
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}),
            page.click('input[type="submit"]')
        ]);

        console.log('\n=========================================================');
        console.log('Se necesita la verificación de dos factores (2FA)');
        console.log('Esperando validación (Timeout de 2 minutos)...');
        console.log('=========================================================\n');
        
        await page.waitForFunction(() => {
            const form = document.querySelector('#q18288');
            const btnTerms = document.querySelector('#terms_accept');
            return form || btnTerms;
        }, { timeout: 120000 });
        
        console.log('Se autenticó, guardando cookies...');
        const currentCookies = await page.cookies();
        fs.writeFileSync(COOKIE_PATH, JSON.stringify(currentCookies, null, 2));
        console.log(`Sesión guardada en ${COOKIE_PATH}. Ya puedes cerrar esta ventana.`);

    } catch (error) {
        console.error('\n[ERROR FATAL] El proceso se detuvo:', error.message);
    } finally {
        await randomDelay(5000, 5000);
        await browser.close();
    }
})();