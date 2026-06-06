# 🤖 Bot de RSS a Discord

Este es un bot ligero y eficiente escrito en **Node.js** que monitorea uno o múltiples feeds RSS (como blogs de WordPress, sitios de noticias, etc.) y envía automáticamente las nuevas publicaciones a tus canales de Discord usando **Webhooks**.

Las publicaciones se muestran en Discord utilizando **Embeds Ricos** (tarjetas de contenido elegantes) con colores personalizados, autor, fecha y miniatura/imagen si la publicación la incluye.

---

## ✨ Características

- 🔄 **Monitoreo de Múltiples Feeds**: Configura tantos feeds RSS como quieras.
- 🎯 **Enrutamiento Inteligente**: Asocia diferentes feeds a diferentes webhooks (por ejemplo, noticias de tecnología a `#noticias`, anuncios a `#general`).
- 🛡️ **Prevención de Duplicados**: Utiliza una base de datos local JSON (`db.json`) para rastrear qué publicaciones ya han sido enviadas.
- 🚀 **Ejecución Flexible**:
  - **Modo Loop**: El bot corre de manera persistente revisando los feeds cada $N$ minutos.
  - **Modo Único (One-Shot)**: Revisa los feeds una sola vez y finaliza. Ideal para programarlo mediante el Programador de Tareas de Windows (Task Scheduler) o `cron` en Linux.
- 🤫 **Silencioso en el Primer Inicio**: Para evitar saturar tu canal de Discord la primera vez que enciendas el bot, este registrará todas las publicaciones actuales como "ya leídas". Las notificaciones comenzarán a partir de los artículos que se publiquen *después* del primer inicio.

---

## 🛠️ Requisitos Previos

- **Node.js** (Versión 18 o superior recomendada, ya que usa la función nativa `fetch`).

---

## 📦 Instalación

1. Abre una terminal (PowerShell o CMD) en la carpeta del proyecto.
2. Instala las dependencias necesarias ejecutando:
   ```bash
   npm install
   ```

---

## ⚙️ Configuración

### 1. Variables de Entorno (`.env`)
Duplica o renombra el archivo `.env.example` a `.env` y coloca las URLs de tus Webhooks de Discord:

```env
# Webhook por defecto (se usa si un feed no tiene uno específico)
DISCORD_WEBHOOK_DEFAULT=https://discord.com/api/webhooks/...

# Webhooks específicos para tus feeds
DISCORD_WEBHOOK_WORDPRESS=https://discord.com/api/webhooks/...
```

> **¿Cómo crear un Webhook en Discord?**
> 1. Ve a los ajustes del canal de Discord donde quieres recibir las noticias.
> 2. Entra en **Integraciones** > **Webhooks**.
> 3. Haz clic en **Crear Webhook** o **Nuevo Webhook**.
> 4. Copia la URL del Webhook generada y pégala en tu archivo `.env`.

### 2. Configuración de Feeds (`config.json`)
Edita el archivo `config.json` para agregar los blogs o sitios que deseas monitorear:

```json
{
  "checkIntervalMinutes": 15,
  "loopMode": true,
  "feeds": [
    {
      "name": "WordPress News",
      "url": "https://wordpress.org/news/feed/",
      "webhookEnvVar": "DISCORD_WEBHOOK_WORDPRESS",
      "color": "#21759b"
    }
  ]
}
```

**Propiedades de la Configuración:**
- `checkIntervalMinutes`: Intervalo en minutos en el que el bot revisará los feeds (solo aplica si `loopMode` es `true`).
- `loopMode`: 
  - `true`: El bot se queda corriendo y revisa periódicamente.
  - `false`: El bot revisa los feeds una vez y se apaga de inmediato.
- `feeds`: Lista de feeds a revisar:
  - `name`: Nombre descriptivo (aparecerá en el pie de página de la tarjeta de Discord).
  - `url`: Enlace del feed RSS/XML del sitio.
  - `webhookEnvVar`: Nombre de la variable de entorno en tu archivo `.env` que tiene la URL del webhook de este feed. Si no se encuentra, usará `DISCORD_WEBHOOK_DEFAULT`.
  - `color`: Color de la barra lateral del mensaje en Discord (formato Hexadecimal, ej: `#ff0055`).

---

## 🚀 Cómo Ejecutar el Bot

Para iniciar el bot, simplemente ejecuta:
```bash
npm start
```

### Ejecutar como Servicio en Segundo Plano (Recomendado para servidores)
Si estás usando `loopMode: true` y quieres que corra siempre en segundo plano, te recomendamos usar un administrador de procesos como `pm2`:

```bash
# Instalar PM2 de forma global
npm install -g pm2

# Iniciar el bot con PM2
pm2 start index.js --name "rss-discord-bot"

# Asegurar que se inicie tras un reinicio del sistema
pm2 startup
pm2 save
```
