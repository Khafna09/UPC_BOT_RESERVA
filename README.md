# Sistema Automatizado de Reservas de Cubiculos

Desarrollo en Node.js mediante Puppeteer para la automatización total de reservas de cubículos de la sede de San Miguel UPC. Diseñado para funcionar en modo *Serverless* vía GitHub Actions, evadiendo restricciones de renderizado (scroll horizontal, Timezones) e implementando manejo de sesión con Bypass de Microsoft 2FA.


## Características
* **Timer:** Algoritmo de hibernación que sincroniza la ejecución con el reloj atómico del servidor para disparar el *payload* exactamente en el segundo 00:00:05.
* **Session Injection:** Permite autenticar el bot en servidores CI/CD sin intervención humana almacenando el estado persistente del navegador en Secrets.
* **External Triggering:** Uso de Webhooks (`repository_dispatch`) para evadir las colas globales de baja prioridad de GitHub Actions.

## Configuración del Entorno Local

1. Instalar dependencias:
  
   npm install

2. Clonar archivo de variables y reutilizar con credenciales a usar

3. Ejecutar el script generador de cookies. Esto abrirá un navegador Chromium. Inicia sesión normalmente y aprueba la solicitud 2FA en tu dispositivo móvil. Las cookies se guardarán en cookies.json

    node generate-cookies.js

4. Despliegue en github Actions

    Dirigirse a Settings (repositorio) > Secret and Variables > Actions
    Crear los Repository Secrets

    - UPC_CORREO, UPC_PASSWORD

    - COMPANERO_NOMBRE, COMPANERO_CODIGO

    - HORA_INICIO (ej. 20:00), HORA_FIN (ej. 22:00)

    - SAVED_COOKIES (Pega todo el contenido del archivo cookies.json generado localmente).

5. Configuración del Cronjob Externo (Debido a que programar una tarea de ejecución automática en github nos genera tardanzas debido a las colas usamos este sistema de "activación externa")

    - Generar un Personal Access Token (Classic) en GitHub marcando el scope repo (se obtendrá un token)
    - Crear una cuenta en cron-job.org.
    - Crear un nuevo Job con los siguientes parámetros:
        URL: https://api.github.com/repos/TU_USUARIO/REPOSITORIO/dispatches

        Configurar la hora de activación a las 23:55 del día anterior a la activación **(ej: los horaios de reserva del día miercoles aparecen el dia martes a las 00:00:01 por lo que el horario del cron job debe activarse el día Lunes a las 23:55 para mantenerse en espera)**

        En la seccion de Opciones Avanzadas configurar la zona horaria, cambiar al método POST, usar los Headers **Accept: application/vnd.github.v3+json** - **User-Agent: CronJob** - **Authorization: Bearer TOKEN GITHUB** - **Body: {"event_type": "trigger_reserva"}**