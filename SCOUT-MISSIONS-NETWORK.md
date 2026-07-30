# Red Scout universal por misiones

## Regla central

Cada persona registrada en ROIS conserva un solo codigo Scout global. El codigo
pertenece al perfil universal y no a una empresa.

Las empresas:

- publican oportunidades con la opcion `Mision Scout`;
- definen el resultado que genera comision y su monto;
- reciben participantes que voluntariamente se vinculan con su codigo global;
- revisan prospectos, validan resultados y consultan obligaciones de comision;
- nunca crean, reemplazan ni asignan codigos Scout.

Los usuarios:

- consultan misiones publicadas;
- se unen con su codigo Scout existente;
- registran prospectos con consentimiento expreso;
- consultan comisiones pendientes, aprobadas y pagadas en `Ingresos`.

## Componentes

### Perfil universal

`user_profiles.scout_code` almacena el codigo global y
`user_profiles.scout_active` controla si puede utilizarse. La migracion conserva
codigos legacy cuando existen y genera uno solamente cuando el perfil no tiene
codigo.

### Mision empresarial

Una oportunidad se convierte en mision al activar `scout_enabled`. La empresa
configura:

- evento que dispara la comision;
- monto y moneda;
- terminos;
- aprobacion previa opcional.

### CRM Scout

El panel empresarial `Red Scout` muestra:

- misiones publicadas;
- usuarios vinculados;
- prospectos registrados;
- avance de cada prospecto;
- activaciones;
- comisiones generadas.

### Comisiones

Cuando un prospecto alcanza el estado configurado en la mision, Supabase crea
una comision pendiente de forma idempotente. El administrador aprueba y marca el
pago; la empresa consulta la obligacion y el usuario ve el ingreso.

## Despliegue

1. Confirmar que `supabase-opportunities-marketplace-v1.sql` ya fue ejecutado.
2. Ejecutar completo `supabase-scout-missions-network.sql` en Supabase SQL Editor.
3. Subir al sitio `app.js`, `index.html` y `styles.css`.
4. Recargar el sitio sin cache.

Esta integracion no requiere una Edge Function ni cambios en Stripe.

## Prueba minima

1. Iniciar sesion con un perfil universal y confirmar que aparece un codigo.
2. Desde una empresa, crear una oportunidad y activar `Mision Scout`.
3. Aprobar y publicar la oportunidad desde Admin.
4. Desde el perfil universal, unirse a la mision.
5. Si requiere aprobacion, activarlo desde `Empresa > Red Scout`.
6. Registrar un prospecto con consentimiento.
7. Avanzar el prospecto hasta el resultado pagable.
8. Confirmar que la comision aparece en Empresa, Admin y `Ingresos` del usuario.

## Seguridad

RLS limita:

- al usuario a sus vinculaciones, prospectos y comisiones;
- a la empresa a registros vinculados con su propia cuenta;
- al administrador a la supervision y liquidacion de comisiones.

Los datos del prospecto requieren confirmacion de consentimiento antes del
registro. No se usan llaves `service_role` en el frontend.
