// routes/registro.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getConnection } = require('../conexion');
const { v4: uuidv4 } = require('uuid');

// 🔍 Función para validar cédula ecuatoriana
const validarCedulaEcuador = (cedula) => {
    if (!/^\d{10}$/.test(cedula)) return false;
    
    const provincia = parseInt(cedula.substring(0, 2), 10);
    if (provincia < 1 || provincia > 24) return false;
    
    const tercerDigito = parseInt(cedula[2], 10);
    if (tercerDigito < 0 || tercerDigito > 6) return false;
    
    const digitos = cedula.split('').map(Number);
    let suma = 0;
    
    for (let i = 0; i < 9; i++) {
        let valor = digitos[i];
        if (i % 2 === 0) {
            valor *= 2;
            if (valor > 9) valor -= 9;
        }
        suma += valor;
    }
    
    const digitoVerificador = (10 - (suma % 10)) % 10;
    return digitoVerificador === digitos[9];
};

// ============================================================================
// 🔍 GET /nutricionapp-api/registro/buscar-paciente
// 👉 BUSCAR PACIENTE EXISTENTE POR CÉDULA O NOMBRE
// ============================================================================
router.get('/buscar-paciente', async (req, res) => {
    const { cedula, nombre, apellido } = req.query;
    
    if (!cedula && (!nombre || !apellido)) {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'Debe proporcionar cédula o nombre+apellido para buscar' 
        });
    }

    let connection;
    try {
        connection = await getConnection();
        
        let query = '';
        let params = [];
        
        if (cedula) {
            query = `
                SELECT 
                    p.id,
                    p.nombres,
                    p.apellidos,
                    p.numero_identificacion,
                    p.fecha_nacimiento,
                    p.sexo,
                    p.direccion,
                    p.telefono,
                    p.ocupacion,
                    p.actividad_fisica,
                    p.usuario_id,
                    u.correo as correo_existente,
                    r.nombre as rol_existente
                FROM pacientes p
                LEFT JOIN usuarios u ON u.id = p.usuario_id
                LEFT JOIN roles r ON r.id = u.rol_id
                WHERE p.numero_identificacion = ? 
                  AND p.eliminado_en IS NULL
                LIMIT 1
            `;
            params = [cedula];
        } else {
            query = `
                SELECT 
                    p.id,
                    p.nombres,
                    p.apellidos,
                    p.numero_identificacion,
                    p.fecha_nacimiento,
                    p.sexo,
                    p.direccion,
                    p.telefono,
                    p.ocupacion,
                    p.actividad_fisica,
                    p.usuario_id,
                    u.correo as correo_existente,
                    r.nombre as rol_existente
                FROM pacientes p
                LEFT JOIN usuarios u ON u.id = p.usuario_id
                LEFT JOIN roles r ON r.id = u.rol_id
                WHERE LOWER(p.nombres) LIKE LOWER(?) 
                  AND LOWER(p.apellidos) LIKE LOWER(?)
                  AND p.eliminado_en IS NULL
                LIMIT 1
            `;
            params = [`%${nombre}%`, `%${apellido}%`];
        }
        
        const [pacientes] = await connection.execute(query, params);
        
        if (pacientes.length === 0) {
            return res.status(200).json({
                error: false,
                encontrado: false,
                mensaje: 'No se encontraron registros previos'
            });
        }
        
        const paciente = pacientes[0];
        
        // 🆕 CASO 1: Si ya tiene usuario vinculado Y el rol es paciente
        if (paciente.usuario_id && paciente.correo_existente && paciente.rol_existente === 'paciente') {
            return res.status(200).json({
                error: false,
                encontrado: true,
                ya_registrado: true,
                mensaje: 'Este paciente ya tiene una cuenta. Por favor inicie sesión.',
                correo: paciente.correo_existente
            });
        }
        
        // 🆕 CASO 2: Si tiene usuario vinculado pero con OTRO rol (ej: nutricionista)
        if (paciente.usuario_id && paciente.correo_existente && paciente.rol_existente !== 'paciente') {
            return res.status(200).json({
                error: false,
                encontrado: true,
                ya_registrado: true,
                rol_diferente: true,
                rol_existente: paciente.rol_existente,
                mensaje: `Esta cédula ya está registrada como <strong>${paciente.rol_existente}</strong>. Inicie sesión con su cuenta existente o contacte al administrador.`,
                correo: paciente.correo_existente
            });
        }
        
        // ✅ CASO 3: Paciente existe pero NO tiene cuenta → autocompletar
        return res.status(200).json({
            error: false,
            encontrado: true,
            ya_registrado: false,
            paciente_id: paciente.id,
            datos: {
                nombre: paciente.nombres,
                apellido: paciente.apellidos,
                cedula: paciente.numero_identificacion,
                fechaNacimiento: paciente.fecha_nacimiento 
                    ? new Date(paciente.fecha_nacimiento).toISOString().split('T')[0] 
                    : null,
                genero: paciente.sexo,
                telefono: paciente.telefono,
                direccion: paciente.direccion,
                ocupacion: paciente.ocupacion,
                actividadFisica: paciente.actividad_fisica
            },
            mensaje: '✅ Se encontraron tus datos. Complete su correo y contraseña para crear su cuenta.'
        });

    } catch (err) {
        console.error('❌ Error buscando paciente:', err);
        return res.status(500).json({ 
            error: true, 
            mensaje: 'Error al buscar paciente' 
        });
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
});

// ============================================================================
// 📝 POST /nutricionapp-api/registro
// 👉 REGISTRO DE NUEVO USUARIO
// ============================================================================
router.post('/', async (req, res) => {
    const {
        nombre, apellido, fechaNacimiento, edad, cedula, genero, telefono,
        ubicacion, correo, password, rol, aceptaTerminos,
        pacienteExistenteId, vincularPaciente
    } = req.body;

    // Validaciones básicas
    if (!nombre || !apellido || !cedula || !correo || !password || !rol) {
        return res.status(400).json({ error: true, mensaje: 'Faltan campos obligatorios' });
    }

    if (!aceptaTerminos) {
        return res.status(400).json({ error: true, mensaje: 'Debe aceptar los términos y condiciones' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: true, mensaje: 'La contraseña debe tener al menos 6 caracteres' });
    }

    if (!validarCedulaEcuador(cedula)) {
        return res.status(400).json({ 
            error: true, 
            mensaje: 'Cédula ecuatoriana inválida. Verifique el número e intente nuevamente.' 
        });
    }

    let connection;
    try {
        connection = await getConnection();

        // 🆕 Verificar si el correo ya existe
        const [existeCorreo] = await connection.execute(
            'SELECT id, rol_id FROM usuarios WHERE correo = ? AND eliminado_en IS NULL',
            [correo.toLowerCase().trim()]
        );
        if (existeCorreo.length > 0) {
            return res.status(409).json({ error: true, mensaje: 'El correo ya está registrado' });
        }

        // 🆕 Verificar si la cédula ya existe en usuarios
        const [existeCedula] = await connection.execute(
            `SELECT u.id, u.correo, r.nombre as rol_nombre 
             FROM usuarios u 
             LEFT JOIN roles r ON r.id = u.rol_id 
             WHERE u.cedula = ? AND u.eliminado_en IS NULL`,
            [cedula]
        );

        if (existeCedula.length > 0) {
            const usuarioExistente = existeCedula[0];
            
            // 🆕 Si la cédula ya existe con el MISMO rol que intenta registrar
            if (usuarioExistente.rol_nombre === rol.toLowerCase()) {
                return res.status(409).json({ 
                    error: true, 
                    mensaje: `La cédula ya está registrada como ${rol}. Por favor inicie sesión o recupere su contraseña.` 
                });
            }
            
            // 🆕 Si la cédula ya existe con OTRO rol
            return res.status(409).json({ 
                error: true, 
                mensaje: `La cédula ya está registrada como <strong>${usuarioExistente.rol_nombre}</strong>. No puede registrarse con otro rol usando la misma cédula. Contacte al administrador.` 
            });
        }

        // Obtener rol_id
        const [roles] = await connection.execute(
            'SELECT id FROM roles WHERE nombre = ?',
            [rol.toLowerCase()]
        );
        if (roles.length === 0) {
            return res.status(400).json({ error: true, mensaje: 'Rol no válido' });
        }
        const rol_id = roles[0].id;

        const password_hash = await bcrypt.hash(password, 10);
        const usuarioId = uuidv4();

        // Crear usuario
        await connection.execute(
            `INSERT INTO usuarios (
                id, rol_id, correo, password_hash, nombre, apellido, cedula,
                genero, telefono, fecha_nacimiento, edad,
                direccionresidencial, ciudad,
                provincia, provincia_codigo, canton, canton_codigo,
                parroquia, parroquia_codigo,
                activo, acepta_terminos
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                usuarioId, rol_id, correo.toLowerCase().trim(), password_hash,
                nombre.trim(), apellido.trim(), cedula,
                genero || null, telefono || null, fechaNacimiento || null, edad || null,
                ubicacion?.direccion || null, ubicacion?.ciudad || null,
                ubicacion?.provincia || null, ubicacion?.provinciaCodigo || null,
                ubicacion?.canton || null, ubicacion?.cantonCodigo || null,
                ubicacion?.parroquia || null, ubicacion?.parroquiaCodigo || null,
                1, aceptaTerminos ? 1 : 0
            ]
        );

        console.log(`✅ Usuario creado: ${usuarioId} (${rol})`);

        // Si es paciente, vincular con paciente existente o crear nuevo
        if (rol.toLowerCase() === 'paciente') {
            if (vincularPaciente && pacienteExistenteId) {
                // 🆕 VINCULAR paciente existente al nuevo usuario
                const [updateResult] = await connection.execute(
                    `UPDATE pacientes 
                     SET usuario_id = ?, 
                         actualizado_en = NOW()
                     WHERE id = ?`,
                    [usuarioId, pacienteExistenteId]
                );
                
                if (updateResult.affectedRows > 0) {
                    console.log(`✅ Paciente ${pacienteExistenteId} vinculado al usuario ${usuarioId}`);
                } else {
                    console.warn(`⚠️ No se pudo vincular paciente ${pacienteExistenteId}`);
                }
            } else {
                // CREAR nuevo paciente
                const nuevoPacienteId = uuidv4();
                await connection.execute(
                    `INSERT INTO pacientes (
                        id, usuario_id, nombres, apellidos, numero_identificacion,
                        fecha_nacimiento, sexo, telefono, direccion, ocupacion, actividad_fisica, activo
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        nuevoPacienteId, usuarioId, nombre.trim(), apellido.trim(), cedula,
                        fechaNacimiento || null, genero || null, telefono || null,
                        ubicacion?.direccion || null, null, null, 1
                    ]
                );
                console.log(`✅ Nuevo paciente creado: ${nuevoPacienteId}`);
            }
        }

        return res.status(201).json({
            error: false,
            mensaje: 'Usuario registrado exitosamente',
            usuario: {
                id: usuarioId,
                nombre: nombre.trim(),
                apellido: apellido.trim(),
                correo: correo.toLowerCase().trim(),
                rol: rol.toLowerCase()
            }
        });

    } catch (err) {
        console.error("❌ Error en registro:", err);
        return res.status(500).json({ 
            error: true, 
            mensaje: 'Error al crear la cuenta: ' + err.message 
        });
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
});

module.exports = router;