# Onboarding de un cliente nuevo

Este documento contiene 3 piezas reutilizables:

1. **Plantilla para enviar al cliente** — pídele estos accesos
2. **Tu checklist interno** — qué necesitas tener antes de provisionar
3. **Plantilla de prompt para Claude** — pégala en una conversación nueva con todos los datos llenos

---

## 1. Plantilla para enviar al cliente

Copia el siguiente texto y mándaselo al cliente nuevo. Reemplaza `[TU BUSINESS MANAGER ID]` con el tuyo.

---

> **Hola, para configurar tu dashboard de monitoreo de redes sociales y ads, necesito 3 cosas:**
>
> ### 1. Acceso de partner en tu Meta Business Manager (3 minutos)
>
> Esto me da acceso a leer tus métricas y comentarios sin que me compartas contraseñas. Pasos:
>
> 1. Entra a [business.facebook.com/settings/partners](https://business.facebook.com/settings/partners)
> 2. Click en **"Agregar"** → **"Otorgar acceso a un socio"**
> 3. Pega mi Business Manager ID: **`[TU BUSINESS MANAGER ID]`**
> 4. Asigna estos permisos sobre los siguientes activos:
>    - **Página de Facebook**: Acceso completo
>    - **Cuenta de Instagram**: Acceso completo
>    - **Cuenta publicitaria**: Anunciante o Administrador
> 5. Click en **"Guardar"**
>
> ### 2. Compartirme estos 3 IDs
>
> - **Instagram Business Account ID** — lo encuentras en Meta Business Suite → Configuración → Cuentas → Instagram → "ID de la cuenta"
> - **Facebook Page ID** — lo encuentras en tu página de Facebook → "Acerca de" → al fondo de la página
> - **Cuenta publicitaria (Ad Account ID)** — Ads Manager arriba a la izquierda dice "act_XXXXXXXXX"; mándame solo los números
>
> ### 3. Tu logo y colores de marca
>
> - Logo cuadrado en JPG o PNG, mínimo 200x200 px
> - Tu color principal (hex, ej: #FF5500)
> - Tu color oscuro complementario (hex, ej: #4D1A00)
>
> Cuando tengas todo listo me lo mandas y en menos de 5 minutos te tengo el dashboard activo en `[TU_CLIENTE].hrikrdo.com` con sus credenciales.

---

## 2. Tu checklist interno (antes de provisionar)

Antes de crear el cliente en el VPS, asegúrate de tener:

- [ ] Confirmación de que el cliente otorgó Partner Access (verificable entrando a Business Manager)
- [ ] Los 3 IDs (IG, FB, Ad Account)
- [ ] Logo descargado a `/tmp/<slug>-logo.jpg` (puedes scp-iarlo al VPS o usar la copia local)
- [ ] Decididos los siguientes valores:
  - [ ] **slug** (lowercase, sin espacios, ej: `acme`, `pizzeria-lima`)
  - [ ] **subdomain** completo (ej: `acme.hrikrdo.com`)
  - [ ] **port** disponible — usa el siguiente número libre. Asignados:
    - 3002 → Glasscare
    - 3003 → siguiente cliente
    - 3004 → tercer cliente
    - …
  - [ ] **filtro de campañas** (palabra que aparece en sus campañas Meta — vacío = sincroniza todas)
  - [ ] **descripción 1-línea** de la empresa (para el prompt de IA)
  - [ ] **brand colors** primario y profundo

---

## 3. Plantilla de prompt para Claude

Cuando tengas todo listo, abre una conversación nueva con Claude y pégale esto (reemplazando los `<...>`):

```
Crear dashboard nuevo desde el boilerplate social-monitor.

Datos del cliente:
- slug: <acme>
- nombre completo: <Acme Corp>
- ubicación: <Panama>
- descripción 1-línea: <una empresa de e-commerce de calzado deportivo>
- subdominio: <acme.hrikrdo.com>
- puerto: <3003>
- Instagram Account ID: <17841...>
- Facebook Page ID: <11365...>
- Ad Account ID: <15810...>
- filtro de campañas: <acme>
- brand color primario: <#0066ff>
- brand color profundo: <#001e4d>

El logo está en mi máquina local en: <ruta/al/logo.jpg>
(o ya está subido al VPS en: /tmp/acme-logo.jpg)

Por favor:
1. Sube el logo al VPS si no está
2. Ejecuta el script provision-client en el VPS con esos parámetros
3. Verifica que https://<subdominio>/api/health responda 200
4. Confírmame con un resumen
```

Claude tiene SSH al VPS y los secretos compartidos en `/opt/clients/.shared/shared.env`, así que solo necesita los datos específicos del cliente. En 30-45 segundos el dashboard queda live.

---

## Lista de clientes activos en el VPS

| Slug | Nombre | Subdomain | Puerto | Status |
|------|--------|-----------|--------|--------|
| glasscare | Glasscare Panama | glasscare.hrikrdo.com | 3002 | active |

Actualiza esta tabla cada vez que provisiones un cliente nuevo.

---

## Comandos útiles para ti (administración del VPS)

```bash
# Ver todos los clientes activos
pm2 list

# Ver logs de un cliente específico
pm2 logs glasscare-monitor --lines 100

# Reiniciar un cliente
pm2 restart acme-monitor

# Sincronizar manualmente (sin esperar al cron)
curl -X POST https://acme.hrikrdo.com/api/sync

# Health check de todos
for url in glasscare acme cliente3; do
  echo -n "$url: "; curl -s https://$url.hrikrdo.com/api/health | jq -r .status
done

# Backup de todas las DBs
tar -czf /backup/clients-$(date +%Y%m%d).tar.gz /opt/clients/*/data/

# Decommission un cliente
pm2 delete acme-monitor && pm2 save
# (luego editar manualmente /etc/cloudflared/config.yml para quitar la entrada)
# (luego borrar el CNAME en Cloudflare)
mv /opt/clients/acme /opt/.acme.backup-$(date +%Y%m%d)
```

## Actualizar el boilerplate en TODOS los clientes a la vez

Cuando hagas mejoras al boilerplate y las pushees a GitHub:

```bash
for dir in /opt/clients/*/; do
  slug=$(basename "$dir")
  [[ "$slug" == ".shared" ]] && continue
  echo "→ Updating $slug"
  cd "$dir"
  git pull --rebase
  npm install --omit=dev --silent
  pm2 restart "${slug}-monitor"
done
```
