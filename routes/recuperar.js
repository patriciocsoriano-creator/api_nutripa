// routes/recuperar.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getConnection } = require('../conexion');
const { v4: uuidv4 } = require('uuid');

//  IMPORTAR SERVICIO DE EMAIL (centralizado)
const emailService = require('../services/email.service');

// ============================================
//  FUNCIONES AUXILIARES
// ============================================

//  Generar código de verificación de 6 dígitos
const generarCodigo = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

//  Verificar si una fecha de expiración ya pasó
const estaExpirado = (fechaExpiracion) => {
    if (!fechaExpiracion) return true;
    const ahora = new Date();
    const expira = new Date(fechaExpiracion);
    return ahora > expira;
};

//  Rate limiting simple en memoria (para desarrollo)
//  En producción, usar Redis + express-rate-limit
const rateLimitStore = new Map();

const verificarRateLimit = (ip, maxRequests = 3, windowMs = 15 * 60 * 1000) => {
    const key = `recuperar:${ip}`;
    const now = Date.now();
    
    let record = rateLimitStore.get(key);
    
    if (!record || now > record.resetAt) {
        // Nueva ventana de tiempo
        record = { count: 1, resetAt: now + windowMs };
    } else if (record.count >= maxRequests) {
        // Límite excedido
        const secondsLeft = Math.ceil((record.resetAt - now) / 1000);
        return { allowed: false, retryAfter: secondsLeft };
    } else {
        // Dentro del límite
        record.count++;
    }
    
    rateLimitStore.set(key, record);
    return { allowed: true };
};

// ============================================
//  ENDPOINT 1: Solicitar código de recuperación
// POST /nutricionapp-api/recuperar/solicitar-codigo
// ============================================
router.post('/solicitar-codigo', async (req, res) => {
    const { correo } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    //  Validación básica de entrada
    if (!correo || typeof correo !== 'string') {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'El correo electrónico es requerido' 
        });
    }

    const emailNormalizado = correo.toLowerCase().trim();

    //  Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNormalizado)) {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'Formato de correo electrónico no válido' 
        });
    }

    //  Rate limiting: máx 3 solicitudes por IP cada 15 minutos
    const rateLimit = verificarRateLimit(ip, 3, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
        return res.status(429).json({
            error: true,
            mensaje: `Demasiados intentos. Espera ${rateLimit.retryAfter} segundos.`
        });
    }

    let connection;
    try {
        connection = await getConnection();

        //  Verificar que el usuario existe (sin revelar si existe o no por seguridad)
        const [usuarios] = await connection.execute(
            `SELECT id, nombre, apellido, activo, correo 
             FROM usuarios 
             WHERE correo = ? AND eliminado_en IS NULL`,
            [emailNormalizado]
        );

        //  Por seguridad, siempre respondemos 200 incluso si el email no existe
        // Esto previene ataques de enumeración de usuarios
        if (usuarios.length === 0) {
            console.log(` [RECUPERAR] Intento con email no registrado: ${emailNormalizado}`);
            return res.status(200).json({ 
                error: false, 
                mensaje: 'Si el correo está registrado, recibirás un código de verificación',
                ocultar: true
            });
        }

        const usuario = usuarios[0];

        //  Verificar que la cuenta está activa
        if (!usuario.activo) {
            return res.status(403).json({ 
                error: true, 
                mensaje: 'Esta cuenta está desactivada. Contacta a soporte.' 
            });
        }

        //  Generar código y token único
        const codigo = generarCodigo();
        const tokenId = uuidv4();
        const expiraEn = new Date();
        expiraEn.setMinutes(expiraEn.getMinutes() + 15); // +15 minutos

        //  Insertar o actualizar registro de recuperación
        await connection.execute(
            `INSERT INTO recuperacion_password 
                (id, usuario_id, codigo, expira_en, usado, creado_en) 
             VALUES (?, ?, ?, ?, 0, NOW())
             ON DUPLICATE KEY UPDATE 
                codigo = VALUES(codigo), 
                expira_en = VALUES(expira_en), 
                usado = 0, 
                usado_en = NULL`,
            [tokenId, usuario.id, codigo, expiraEn]
        );

        //  Enviar email usando el servicio centralizado
        try {
            await emailService.sendRecoveryEmail(
                usuario.correo,
                `${usuario.nombre} ${usuario.apellido}`,
                codigo
            );
            console.log(` [EMAIL] Código enviado a ${usuario.correo}`);
        } catch (emailError) {
            console.error(' [EMAIL] Error al enviar:', emailError.message);
            // No revelamos el error de email al usuario por seguridad
            throw new Error('No se pudo enviar el código. Intenta más tarde.');
        }

        //  Respuesta exitosa (sin revelar datos sensibles)
        return res.status(200).json({
            error: false,
            mensaje: 'Código de verificación enviado',
            datos: {
                correo: emailNormalizado,
                nombre: usuario.nombre
            }
        });

    } catch (err) {
        console.error(' [RECUPERAR] Error en solicitar-codigo:', err);
        
        if (err.message?.includes('No se pudo enviar')) {
            return res.status(503).json({ error: true, mensaje: err.message });
        }
        
        return res.status(500).json({ 
            error: true, 
            mensaje: 'Error interno del servidor. Intenta más tarde.' 
        });
        
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
});

// ============================================
//  ENDPOINT 2: Verificar código ingresado
// POST /nutricionapp-api/recuperar/verificar-codigo
// ============================================
router.post('/verificar-codigo', async (req, res) => {
    const { correo, codigo } = req.body;

    //  Validación de entrada
    if (!correo || !codigo) {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'Correo y código de verificación son requeridos' 
        });
    }

    if (typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'El código debe ser de 6 dígitos numéricos' 
        });
    }

    const emailNormalizado = correo.toLowerCase().trim();
    let connection;

    try {
        connection = await getConnection();

        //  Obtener ID del usuario
        const [usuarios] = await connection.execute(
            'SELECT id FROM usuarios WHERE correo = ? AND eliminado_en IS NULL AND activo = 1',
            [emailNormalizado]
        );

        if (usuarios.length === 0) {
            return res.status(400).json({ 
                error: true, 
                mensaje: 'Código inválido o expirado' 
            });
        }

        const usuarioId = usuarios[0].id;

        //  Buscar el registro de recuperación más reciente y no usado
        const [recuperaciones] = await connection.execute(
            `SELECT id, codigo, expira_en, usado, creado_en 
             FROM recuperacion_password 
             WHERE usuario_id = ? AND usado = 0 
             ORDER BY creado_en DESC 
             LIMIT 1`,
            [usuarioId]
        );

        if (recuperaciones.length === 0) {
            return res.status(400).json({ 
                error: true, 
                mensaje: 'Código inválido o expirado' 
            });
        }

        const registro = recuperaciones[0];

        //  Validar código
        if (registro.codigo !== codigo) {
            return res.status(400).json({ 
                error: true, 
                mensaje: 'Código incorrecto' 
            });
        }

        //  Validar expiración
        if (estaExpirado(registro.expira_en)) {
            await connection.execute(
                'UPDATE recuperacion_password SET usado = 1, usado_en = NOW() WHERE id = ?',
                [registro.id]
            );
            return res.status(400).json({ 
                error: true, 
                mensaje: 'El código ha expirado. Solicita uno nuevo.' 
            });
        }

        //  ¡Éxito! Código válido y no expirado
        return res.status(200).json({
            error: false,
            mensaje: 'Código verificado correctamente',
            token: registro.id  // ← Token para usar en el siguiente paso
        });

    } catch (err) {
        console.error(' [RECUPERAR] Error en verificar-codigo:', err);
        return res.status(500).json({ 
            error: true, 
            mensaje: 'Error al verificar el código. Intenta más tarde.' 
        });
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
});

// ============================================
//  ENDPOINT 3: Resetear contraseña
// POST /nutricionapp-api/recuperar/resetear-password
// ============================================
router.post('/resetear-password', async (req, res) => {
    const { token, nuevaPassword } = req.body;

    //  Validación de entrada
    if (!token || !nuevaPassword) {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'Token y nueva contraseña son requeridos' 
        });
    }

    if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'Token de recuperación inválido' 
        });
    }

    //  Validaciones de seguridad para la contraseña
    if (typeof nuevaPassword !== 'string' || nuevaPassword.length < 6) {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'La contraseña debe tener al menos 6 caracteres' 
        });
    }

    if (nuevaPassword.length > 128) {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'La contraseña es demasiado larga' 
        });
    }

    let connection;
    let transactionStarted = false;

    try {
        connection = await getConnection();
        
        //  Iniciar transacción para asegurar consistencia
        await connection.beginTransaction();
        transactionStarted = true;

        //  Verificar token válido, no usado y no expirado
        const [recuperaciones] = await connection.execute(
            `SELECT rp.id, rp.usuario_id, rp.expira_en, rp.usado, u.correo, u.nombre
             FROM recuperacion_password rp
             INNER JOIN usuarios u ON rp.usuario_id = u.id
             WHERE rp.id = ? AND rp.usado = 0`,
            [token]
        );

        if (recuperaciones.length === 0) {
            await connection.rollback();
            return res.status(400).json({ 
                error: true, 
                mensaje: 'Token inválido o ya utilizado' 
            });
        }

        const registro = recuperaciones[0];

        //  Validar expiración
        if (estaExpirado(registro.expira_en)) {
            await connection.execute(
                'UPDATE recuperacion_password SET usado = 1, usado_en = NOW() WHERE id = ?',
                [token]
            );
            await connection.commit();
            return res.status(400).json({ 
                error: true, 
                mensaje: 'El token ha expirado. Solicita un nuevo código.' 
            });
        }

        //  Hashear la nueva contraseña con bcrypt
        const saltRounds = 12;
        const password_hash = await bcrypt.hash(nuevaPassword, saltRounds);

        //  Actualizar contraseña del usuario
        const [updateResult] = await connection.execute(
            `UPDATE usuarios 
             SET password_hash = ?, 
                 actualizado_en = NOW(),
                 intentos_fallidos = 0
             WHERE id = ? AND eliminado_en IS NULL`,
            [password_hash, registro.usuario_id]
        );

        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(500).json({ 
                error: true, 
                mensaje: 'No se pudo actualizar la contraseña' 
            });
        }

        //  Marcar token como usado (invalidar para reuso)
        await connection.execute(
            `UPDATE recuperacion_password 
             SET usado = 1, usado_en = NOW() 
             WHERE id = ?`,
            [token]
        );

        //  Confirmar transacción
        await connection.commit();
        transactionStarted = false;

        //  Enviar email de confirmación (no crítico, no falla el proceso)
        try {
            await emailService.sendPasswordUpdatedEmail(
                registro.correo,
                registro.nombre
            );
            console.log(` [EMAIL] Confirmación enviada a ${registro.correo}`);
        } catch (emailErr) {
            console.warn(' [EMAIL] No se pudo enviar confirmación:', emailErr.message);
        }

        //  Respuesta exitosa
        return res.status(200).json({
            error: false,
            mensaje: 'Contraseña actualizada exitosamente',
            datos: {
                correo: registro.correo
            }
        });

    } catch (err) {
        console.error(' [RECUPERAR] Error en resetear-password:', err);
        
        if (transactionStarted && connection) {
            try {
                await connection.rollback();
                console.log(' [DB] Transacción revertida');
            } catch (rollbackErr) {
                console.error(' [DB] Error en rollback:', rollbackErr);
            }
        }
        
        return res.status(500).json({ 
            error: true, 
            mensaje: 'Error al actualizar la contraseña. Intenta más tarde.' 
        });
        
    } finally {
        if (connection) {
            try { 
                if (transactionStarted) {
                    await connection.rollback();
                }
                connection.release(); 
            } catch (e) { 
                console.error(' Error liberando conexión:', e); 
            }
        }
    }
});

// ============================================
//  Limpieza periódica de registros expirados (opcional)
//  Puedes ejecutar esto con un cron job o setInterval
// ============================================
const limpiarRegistrosExpirados = async () => {
    let connection;
    try {
        connection = await getConnection();
        const [result] = await connection.execute(
            `DELETE FROM recuperacion_password 
             WHERE expira_en < NOW() OR usado = 1`,
            []
        );
        if (result.affectedRows > 0) {
            console.log(` [LIMPIEZA] Eliminados ${result.affectedRows} registros expirados`);
        }
    } catch (err) {
        console.error(' [LIMPIEZA] Error:', err.message);
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
};

//  Ejecutar limpieza cada hora (solo en desarrollo, en producción usar cron)
if (process.env.NODE_ENV === 'development') {
    setInterval(limpiarRegistrosExpirados, 60 * 60 * 1000);
    console.log(' [RECUPERAR] Limpieza automática de registros expirados activada (cada hora)');
}




// routes/recuperar.js - AGREGAR ESTOS ENDPOINTS

// ============================================
//  ENDPOINT 1: Solicitar código por WhatsApp
// POST /nutricionapp-api/recuperar/solicitar-codigo-whatsapp
// ============================================
// ============================================
//  ENDPOINT: Solicitar código por WhatsApp (CORREGIDO)
// POST /nutricionapp-api/recuperar/solicitar-codigo-whatsapp
// ============================================
router.post('/solicitar-codigo-whatsapp', async (req, res) => {
    const { telefono } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    //  Validación de entrada
    if (!telefono || typeof telefono !== 'string') {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'El número de celular es requerido' 
        });
    }

    //  Normalizar teléfono: quitar +, espacios, guiones
    const telefonoLimpio = telefono.replace(/\D/g, ''); // Solo números: 593963267862
    
    //  Convertir a formato local ecuatoriano si viene con código país
    // Ej: 593963267862 → 0963267862
    let telefonoBusqueda = telefonoLimpio;
    if (telefonoLimpio.startsWith('593') && telefonoLimpio.length === 12) {
        telefonoBusqueda = '0' + telefonoLimpio.substring(3); // 0963267862
    }
    
    //  Validar formato Ecuador: 09XXXXXXXX (10 dígitos)
    const telefonoRegex = /^09\d{8}$/;
    if (!telefonoRegex.test(telefonoBusqueda)) {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'Formato de teléfono no válido. Ej: 0991234567' 
        });
    }

    //  Rate limiting
    const rateLimit = verificarRateLimit(ip, 3, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
        return res.status(429).json({
            error: true,
            mensaje: `Demasiados intentos. Espera ${rateLimit.retryAfter} segundos.`
        });
    }

    let connection;
    try {
        connection = await getConnection();

        //  DEBUG: Log para ver qué se está buscando
        console.log(`🔍 [WHATSAPP] Buscando usuario con teléfono: "${telefonoBusqueda}" (original: "${telefono}")`);

        //  Verificar que el usuario existe por teléfono (formato local)
        const [usuarios] = await connection.execute(
            `SELECT id, nombre, apellido, activo, telefono, correo 
             FROM usuarios 
             WHERE telefono = ? AND eliminado_en IS NULL`,
            [telefonoBusqueda]
        );

        //  Por seguridad, siempre respondemos 200 incluso si no existe
        if (usuarios.length === 0) {
            console.log(` [WHATSAPP]  Teléfono NO registrado en BD: ${telefonoBusqueda}`);
            console.log(` [DEBUG] Teléfonos en BD para referencia: 0983541473, 0939225978, 0985678445`);
            
            return res.status(200).json({ 
                error: false, 
                mensaje: 'Si el número está registrado, recibirás un código por WhatsApp',
                ocultar: true
            });
        }

        const usuario = usuarios[0];
        console.log(` [WHATSAPP] Usuario encontrado: ${usuario.nombre} ${usuario.apellido}`);

        //  Verificar que la cuenta está activa
        if (!usuario.activo) {
            return res.status(403).json({ 
                error: true, 
                mensaje: 'Esta cuenta está desactivada. Contacta a soporte.' 
            });
        }

        //  Generar código y token único
        const codigo = generarCodigo();
        const tokenId = uuidv4();
        const expiraEn = new Date();
        expiraEn.setMinutes(expiraEn.getMinutes() + 15);

        //  Insertar o actualizar registro de recuperación
        await connection.execute(
            `INSERT INTO recuperacion_password 
                (id, usuario_id, codigo, expira_en, usado, creado_en, metodo) 
             VALUES (?, ?, ?, ?, 0, NOW(), 'whatsapp')
             ON DUPLICATE KEY UPDATE 
                codigo = VALUES(codigo), 
                expira_en = VALUES(expira_en), 
                usado = 0, 
                usado_en = NULL,
                metodo = 'whatsapp'`,
            [tokenId, usuario.id, codigo, expiraEn]
        );

        //  Enviar WhatsApp usando el proveedor configurado en .env
        try {
            await enviarWhatsApp(usuario.telefono, usuario.nombre, codigo);
            console.log(` [WHATSAPP] Código enviado a ${usuario.telefono}`);
        } catch (whatsappError) {
            console.error(' [WHATSAPP] Error al enviar:', whatsappError.message);
            
            //  MODO DESARROLLO: Mostrar código en consola si falla el envío
            if (process.env.NODE_ENV === 'development') {
                console.log(` [DEV MODE] Código para ${usuario.nombre}: ${codigo}`);
            }
            
            throw new Error('No se pudo enviar el código por WhatsApp. Intenta más tarde.');
        }

        //  Respuesta exitosa
        return res.status(200).json({
            error: false,
            mensaje: 'Código de verificación enviado por WhatsApp',
            datos: {
                telefono: telefonoBusqueda,
                nombre: usuario.nombre
            }
        });

    } catch (err) {
        console.error(' [WHATSAPP] Error en solicitar-codigo-whatsapp:', err);
        
        if (err.message?.includes('No se pudo enviar')) {
            return res.status(503).json({ error: true, mensaje: err.message });
        }
        
        return res.status(500).json({ 
            error: true, 
            mensaje: 'Error interno del servidor. Intenta más tarde.' 
        });
        
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
});

// ============================================
//  ENDPOINT 2: Verificar código por WhatsApp
// POST /nutricionapp-api/recuperar/verificar-codigo-whatsapp
// ============================================
router.post('/verificar-codigo-whatsapp', async (req, res) => {
    const { telefono, codigo } = req.body;

    //  Validación de entrada con logs
    console.log(` [WHATSAPP] Recibiendo verificación: telefono="${telefono}", codigo="${codigo}"`);
    
    if (!telefono || !codigo) {
        console.log(` [WHATSAPP] Faltan parámetros`);
        return res.status(400).json({ 
            error: true, 
            mensaje: 'Teléfono y código de verificación son requeridos' 
        });
    }

    //  Validar formato de código: debe ser 6 dígitos
    if (typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
        console.log(` [WHATSAPP] Código inválido: "${codigo}"`);
        return res.status(400).json({ 
            error: true, 
            mensaje: 'El código debe ser de 6 dígitos numéricos' 
        });
    }

    //  Normalizar teléfono: aceptar múltiples formatos
    // Entradas posibles: +593963267862, 593963267862, 0963267862, 963267862
    let telefonoLimpio = telefono.replace(/\D/g, ''); // Solo números
    
    // Convertir a formato local para buscar en BD (09XXXXXXXX)
    let telefonoBusqueda = telefonoLimpio;
    if (telefonoLimpio.startsWith('593') && telefonoLimpio.length === 12) {
        telefonoBusqueda = '0' + telefonoLimpio.substring(3); // 593963267862 → 0963267862
    } else if (telefonoLimpio.length === 9) {
        telefonoBusqueda = '0' + telefonoLimpio; // 963267862 → 0963267862
    }
    
    // Validar formato final: 09XXXXXXXX (10 dígitos)
    const telefonoRegex = /^09\d{8}$/;
    if (!telefonoRegex.test(telefonoBusqueda)) {
        console.log(` [WHATSAPP] Formato de teléfono inválido: "${telefono}" → "${telefonoBusqueda}"`);
        return res.status(400).json({ 
            error: true, 
            mensaje: 'Formato de teléfono no válido' 
        });
    }

    console.log(` [WHATSAPP] Buscando usuario con teléfono: "${telefonoBusqueda}"`);

    let connection;

    try {
        connection = await getConnection();

        //  Obtener ID del usuario por teléfono (formato local)
        const [usuarios] = await connection.execute(
            'SELECT id FROM usuarios WHERE telefono = ? AND eliminado_en IS NULL AND activo = 1',
            [telefonoBusqueda]
        );

        if (usuarios.length === 0) {
            console.log(` [WHATSAPP] Usuario no encontrado con teléfono: ${telefonoBusqueda}`);
            return res.status(400).json({ 
                error: true, 
                mensaje: 'Código inválido o expirado' 
            });
        }

        const usuarioId = usuarios[0].id;

        //  Buscar el registro de recuperación más reciente (sin filtrar por metodo)
        const [recuperaciones] = await connection.execute(
            `SELECT id, codigo, expira_en, usado, creado_en 
             FROM recuperacion_password 
             WHERE usuario_id = ? AND usado = 0
             ORDER BY creado_en DESC 
             LIMIT 1`,
            [usuarioId]
        );

        if (recuperaciones.length === 0) {
            console.log(` [WHATSAPP] No hay códigos pendientes para usuario_id: ${usuarioId}`);
            return res.status(400).json({ 
                error: true, 
                mensaje: 'Código inválido o expirado' 
            });
        }

        const registro = recuperaciones[0];
        console.log(`🔍 [WHATSAPP] Código en BD: "${registro.codigo}", recibido: "${codigo}"`);

        //  Validar código
        if (registro.codigo !== codigo) {
            console.log(` [WHATSAPP] Código incorrecto`);
            return res.status(400).json({ 
                error: true, 
                mensaje: 'Código incorrecto' 
            });
        }

        //  Validar expiración
        if (estaExpirado(registro.expira_en)) {
            await connection.execute(
                'UPDATE recuperacion_password SET usado = 1, usado_en = NOW() WHERE id = ?',
                [registro.id]
            );
            console.log(` [WHATSAPP] Código expirado`);
            return res.status(400).json({ 
                error: true, 
                mensaje: 'El código ha expirado. Solicita uno nuevo.' 
            });
        }

        //  ¡Éxito!
        console.log(` [WHATSAPP] Código verificado para usuario_id: ${usuarioId}`);
        return res.status(200).json({
            error: false,
            mensaje: 'Código verificado correctamente',
            token: registro.id
        });

    } catch (err) {
        console.error(' [WHATSAPP] Error en verificar-codigo-whatsapp:', err);
        return res.status(500).json({ 
            error: true, 
            mensaje: 'Error al verificar el código. Intenta más tarde.' 
        });
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
});


// ============================================
//  FUNCIÓN: Enviar WhatsApp (Twilio o Meta según .env)
// ============================================
async function enviarWhatsApp(telefonoDestino, nombreUsuario, codigo) {
    const provider = process.env.WHATSAPP_PROVIDER || 'twilio';
    
    //  Normalizar teléfono para envío: convertir a formato internacional
    // BD tiene: 0983541473 → Enviar: +593983541473
    const telefonoInternacional = telefonoDestino.startsWith('0') 
        ? `+593${telefonoDestino.substring(1)}` 
        : telefonoDestino.startsWith('+') 
            ? telefonoDestino 
            : `+${telefonoDestino}`;

    if (provider === 'twilio') {
        // === TWILIO ===
        const twilio = require('twilio');
        const client = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );
        
        await client.messages.create({
            from: process.env.TWILIO_WHATSAPP_FROM,  // ej: whatsapp:+14155238886
            to: `whatsapp:${telefonoInternacional}`,  // ej: whatsapp:+593983541473
            body: ` Hola ${nombreUsuario}, tu código de recuperación es: *${codigo}*\n\nEste código expira en 15 minutos. No lo compartas con nadie.`
        });
        
    } else if (provider === 'meta') {
        // === META WHATSAPP BUSINESS API ===
        const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        const token = process.env.WHATSAPP_ACCESS_TOKEN;
        const template = process.env.WHATSAPP_TEMPLATE_NAME || 'hello_world';
        const lang = process.env.WHATSAPP_LANGUAGE_CODE || 'en_US';
        
        const body = {
            messaging_product: 'whatsapp',
            to: telefonoInternacional.replace('+', ''),  // Sin el + para Meta: 593983541473
            type: 'template',
            template: {
                name: template,
                language: { code: lang },
                components: [{
                    type: 'body',
                    parameters: [
                        { type: 'text', text: nombreUsuario },
                        { type: 'text', text: codigo }
                    ]
                }]
            }
        };

        const response = await fetch(
            `https://graph.facebook.com/v17.0/${phoneId}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            }
        );
        
        const result = await response.json();
        
        if (result.error) {
            throw new Error(`Meta API Error: ${result.error.message || 'Unknown error'}`);
        }
    }
    
    //  En desarrollo: log para pruebas
    if (process.env.NODE_ENV === 'development') {
        console.log(` [DEV] Código para ${nombreUsuario}: ${codigo}`);
    }
    
    return true;
}

module.exports = router;