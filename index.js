import fs from 'fs';
import path from 'path';
import Parser from 'rss-parser';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

const CONFIG_PATH = './config.json';
const DB_PATH = './db.json';

// Cargar configuración
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Error: No se encontró el archivo de configuración en ${CONFIG_PATH}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

// Inicializar la base de datos de posts procesados
let db = { processedGuids: [] };
if (fs.existsSync(DB_PATH)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (!Array.isArray(db.processedGuids)) {
      db.processedGuids = [];
    }
  } catch (err) {
    console.warn(`Advertencia: No se pudo leer db.json. Se reiniciará la base de datos.`);
  }
}

// Guardar base de datos
function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

const parser = new Parser({
  customFields: {
    item: [
      ['category', 'categories', {keepArray: true}]
    ]
  }
});

// Función para extraer de forma segura las categorías (soporta RSS 2.0 y Atom)
function getCategories(item) {
  if (!item.categories) return [];
  return item.categories.map(c => {
    if (typeof c === 'string') return c;
    if (c && c._) return c._;
    if (c && c.$ && c.$.term) return c.$.term;
    if (typeof c === 'object') return Object.values(c)[0];
    return null;
  }).filter(Boolean);
}

// Función para limpiar/formatear HTML de la descripción/contenido (Summary corto sin saltos de línea)
function cleanHtml(html) {
  if (!html) return '';

  // 1. Eliminar todas las etiquetas HTML reemplazándolas por espacios para no pegar palabras
  let text = html.replace(/<[^>]*>/g, ' ');

  // 2. Decodificar entidades HTML comunes de WordPress
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#8211;/gi, '–')  // En-dash
    .replace(/&#8212;/gi, '—')  // Em-dash
    .replace(/&#8216;/gi, "‘")
    .replace(/&#8217;/gi, "’")  // Right single quote
    .replace(/&#8220;/gi, '“')
    .replace(/&#8221;/gi, '”')
    .replace(/&#8230;/gi, '...');

  // 3. Reemplazar todos los saltos de línea, retornos y tabulaciones con espacios
  text = text.replace(/[\r\n\t]+/g, ' ');

  // 4. Limpiar múltiples espacios consecutivos
  text = text.replace(/\s+/g, ' ');

  // 5. Limitar longitud para un summary corto de 200 caracteres
  if (text.length > 200) {
    text = text.substring(0, 197) + '...';
  }

  return text.trim();
}

// Función para extraer imagen del feed (WordPress suele incluir imágenes en content:encoded)
function extractImage(item) {
  const content = item['content:encoded'] || item.content || '';
  if (!content) return null;

  // 1. Intentar buscar en el content una etiqueta <img>
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/i;
  const match = imgRegex.exec(content);
  if (match && match[1]) {
    return match[1];
  }

  // 2. Intentar con enclosures si no había img en el HTML
  if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
    return item.enclosure.url;
  }
  
  return null;
}

// Enviar post a Discord
async function sendToDiscord(feed, item, matchedCategory) {
  // Determinar qué webhook usar
  let webhookUrl = process.env.DISCORD_WEBHOOK_DEFAULT;
  if (feed.webhookEnvVar && process.env[feed.webhookEnvVar]) {
    webhookUrl = process.env[feed.webhookEnvVar];
  }

  if (!webhookUrl || webhookUrl.includes('TU_WEBHOOK_AQUI')) {
    console.warn(`[${feed.name}] Advertencia: Webhook no configurado o tiene valor por defecto. Saltando envío.`);
    return false;
  }

  // Preparar contenido del embed
  const title = (item.title || 'Nueva publicación')
    .replace(/&#8211;/gi, '–')
    .replace(/&#8217;/gi, "’")
    .replace(/&#8220;/gi, '“')
    .replace(/&#8221;/gi, '”')
    .replace(/&amp;/gi, '&');
  const url = item.link || '';
  
  const author = item.creator || item.author || '';
  const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
  const imageUrl = extractImage(item);

  // Asignar colores por categoría según la configuración del feed
  let colorDecimal = 7506394; // Color default #7289da (Blurple)
  const categoryColors = feed.categoryColors || {};
  const categoryColor = matchedCategory ? categoryColors[matchedCategory] : null;
  if (categoryColor) {
    colorDecimal = parseInt(categoryColor.replace('#', ''), 16);
  } else if (feed.color) {
    colorDecimal = parseInt(feed.color.replace('#', ''), 16);
  }

  const embed = {
    title: title,
    url: url,
    color: colorDecimal,
    timestamp: pubDate.toISOString()
  };

  // Mostrar descripción si está configurada
  if (feed.showDescription !== false) {
    const rawContent = item['content:encoded'] || item.content || item.contentSnippet || '';
    const description = cleanHtml(rawContent);
    if (description) {
      embed.description = description;
    }
  }

  // Mostrar autor si está configurado
  if (feed.showAuthor && author) {
    embed.author = {
      name: author
    };
  }

  // Filtrar categorías para mostrar solo las permitidas en el campo Género
  const allowedCategories = feed.allowedCategories || [];
  const itemCategories = getCategories(item);

  if (itemCategories.length > 0) {
    const matchedCategories = allowedCategories.length > 0
      ? itemCategories.filter(c => allowedCategories.includes(c))
      : itemCategories;

    if (matchedCategories.length > 0) {
      const genres = matchedCategories.map(c => `\`${c}\``).join(', ');
      embed.fields = [
        {
          name: 'Género',
          value: genres,
          inline: true
        }
      ];
    }
  }

  if (imageUrl) {
    // Solo usar proxy si la imagen pertenece al mismo dominio que el feed (evita bloqueos de hotlink internos y errores 429 de proxies en Imgur/etc.)
    let useProxy = false;
    try {
      const feedHost = new URL(feed.url).hostname;
      const imageHost = new URL(imageUrl).hostname;
      if (imageHost.includes(feedHost) || feedHost.includes(imageHost)) {
        useProxy = true;
      }
    } catch (err) {
      // Si falla el parseo, no usar proxy por seguridad
    }

    if (useProxy) {
      const proxiedImageUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}`;
      embed.image = { url: proxiedImageUrl };
    } else {
      embed.image = { url: imageUrl };
    }
  }

  const payload = {
    embeds: [embed]
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log(`[${feed.name}] Publicación enviada con éxito: "${title}"`);
      return true;
    } else {
      console.error(`[${feed.name}] Error enviando a Discord (HTTP ${response.status}):`, await response.text());
      return false;
    }
  } catch (error) {
    console.error(`[${feed.name}] Error de red al enviar a Discord:`, error);
    return false;
  }
}

// Procesar un feed específico
async function processFeed(feed) {
  console.log(`[${feed.name}] Revisando actualizaciones de: ${feed.url}`);
  try {
    const parsedFeed = await parser.parseURL(feed.url);
    
    // Invertir el array para procesar desde el más antiguo al más nuevo
    const items = [...parsedFeed.items].reverse();
    
    let newItemsCount = 0;
    
    for (const item of items) {
      const id = item.guid || item.link || item.id;
      if (!id) continue;
      
      if (!db.processedGuids.includes(id)) {
        // Filtrar por categorías permitidas
        const allowedCategories = feed.allowedCategories || [];
        const itemCategories = getCategories(item);
        
        let matchedCategory = null;
        if (allowedCategories.length > 0) {
          matchedCategory = itemCategories.find(c => allowedCategories.includes(c));
          
          if (!matchedCategory) {
            // No pertenece a ningún género de interés. Marcar procesado en db silenciosamente.
            db.processedGuids.push(id);
            if (db.processedGuids.length > 1000) {
              db.processedGuids.shift();
            }
            saveDb();
            continue;
          }
        }

        // Es un post nuevo de un género permitido. Lo enviamos a Discord.
        const sent = await sendToDiscord(feed, item, matchedCategory);
        if (sent) {
          db.processedGuids.push(id);
          newItemsCount++;
          // Limitar tamaño de base de datos para no crecer infinitamente
          if (db.processedGuids.length > 1000) {
            db.processedGuids.shift();
          }
          saveDb();
        }
      }
    }
    
    if (newItemsCount === 0) {
      console.log(`[${feed.name}] No se encontraron nuevas publicaciones filtradas.`);
    } else {
      console.log(`[${feed.name}] Procesadas ${newItemsCount} nuevas publicaciones filtradas.`);
    }
    
  } catch (error) {
    console.error(`[${feed.name}] Error procesando el feed RSS:`, error.message);
  }
}

// Bucle principal
async function checkAllFeeds() {
  console.log(`--- Iniciando chequeo de feeds: ${new Date().toLocaleString()} ---`);
  for (const feed of config.feeds) {
    await processFeed(feed);
  }
  console.log(`--- Chequeo finalizado ---`);
}

// Lógica de inicio
async function start() {
  // Si la db está vacía en su primera ejecución, registramos los posts actuales
  // en la base de datos sin enviarlos (silencioso), así evitamos spam inicial masivo.
  const isFirstRun = db.processedGuids.length === 0;
  if (isFirstRun) {
    console.log("Primera ejecución detectada. Inicializando base de datos con posts existentes (modo silencioso)...");
    for (const feed of config.feeds) {
      try {
        const parsedFeed = await parser.parseURL(feed.url);
        for (const item of parsedFeed.items) {
          const id = item.guid || item.link;
          if (id && !db.processedGuids.includes(id)) {
            db.processedGuids.push(id);
          }
        }
      } catch (err) {
        console.error(`Error inicializando feed ${feed.name}:`, err.message);
      }
    }
    saveDb();
    console.log("Base de datos inicializada. En la próxima revisión se notificarán los artículos nuevos.");
  } else {
    // Si no es la primera ejecución, corremos el chequeo normal de inmediato
    await checkAllFeeds();
  }

  // Decidir si continuar en bucle o salir
  if (config.loopMode) {
    const intervalMs = (config.checkIntervalMinutes || 15) * 60 * 1000;
    console.log(`Bot en ejecución continua. Próxima revisión en ${config.checkIntervalMinutes} minutos.`);
    setInterval(checkAllFeeds, intervalMs);
  } else {
    console.log("Modo Loop desactivado. Saliendo...");
    process.exit(0);
  }
}

start().catch(err => {
  console.error("Error fatal en el bot:", err);
  process.exit(1);
});
