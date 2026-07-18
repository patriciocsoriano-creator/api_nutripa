// services/email.service.js
const nodemailer = require('nodemailer');

// ============================================
//  CONFIGURACIÓN DEL TRANSPORTER (GMAIL SMTP)
// ============================================
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // false para puerto 587 (TLS)
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    // Configuración adicional para mejorar entrega
    tls: {
        rejectUnauthorized: false
    }
});

// Verificar conexión al iniciar
transporter.verify()
    .then(() => {
        console.log(' [EMAIL] Gmail SMTP configurado correctamente');
        console.log(` [EMAIL] Enviando desde: ${process.env.EMAIL_USER}`);
    })
    .catch(err => {
        console.error(' [EMAIL] Error configurando Gmail SMTP:', err.message);
        if (err.code === 'EAUTH') {
            console.error(' [EMAIL] Verifica:');
            console.error('   1. Que EMAIL_USER sea tu correo Gmail completo');
            console.error('   2. Que EMAIL_PASS sea una Contraseña de Aplicación (no tu contraseña normal)');
            console.error('   3. Que tengas verificación en 2 pasos activada');
            console.error('   4. Genera una nueva en: https://myaccount.google.com/apppasswords');
        }
    });

// ============================================
//  ENVIAR CÓDIGO DE RECUPERACIÓN
// ============================================
async function sendRecoveryEmail(correo, nombre, codigo) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
</head>
<body style="margin: 0; padding: 0; background: #f4f7fb; font-family: 'Segoe UI', Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding: 20px;">
        <tr>
            <td align="center">
                <table width="500" cellpadding="0" cellspacing="0" style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #0a4d68, #145da0); padding: 30px; text-align: center;">
                            <h1 style="color: white; margin: 0; font-size: 24px;">🔐 Recuperación de Contraseña</h1>
                            <p style="color: white; margin: 8px 0 0; opacity: 0.9;">NutriPA - Sistema Clínico Nutricional</p>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 30px;">
                            <p style="font-size: 18px; color: #1a1f36; margin: 0 0 16px;">Hola ${nombre},</p>
                            <p style="color: #6c7293; line-height: 1.6; margin: 0 0 24px;">
                                Hemos recibido una solicitud para restablecer tu contraseña. 
                                Usa el siguiente código de verificación:
                            </p>
                            
                            <!-- Código destacado -->
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="background: #f4f7fb; border: 2px dashed #145da0; border-radius: 12px; padding: 20px; text-align: center;">
                                        <span style="font-size: 36px; font-weight: 700; color: #0a4d68; letter-spacing: 8px; font-family: 'Courier New', monospace;">${codigo}</span>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Advertencia -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                <tr>
                                    <td style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; border-radius: 8px;">
                                        <p style="margin: 0; color: #856404; font-size: 14px;">
                                             <strong>Importante:</strong> Este código expira en <strong>15 minutos</strong>. 
                                            Si no solicitaste este cambio, ignora este correo.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            
                            <p style="color: #6c7293; line-height: 1.6; font-size: 14px; margin: 20px 0 0;">
                                Por seguridad, nunca compartas este código con nadie.
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
                            <p style="margin: 0; color: #9499b7; font-size: 12px;">
                                Este correo fue enviado automáticamente por NutriPA.
                            </p>
                            <p style="margin: 4px 0 0; color: #9499b7; font-size: 12px;">
                                © ${new Date().getFullYear()} NutriPA - Sistema Clínico Nutricional
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;

    const text = `Hola ${nombre},\n\nTu código de recuperación de NutriPA es: ${codigo}\n\nEste código expira en 15 minutos.\n\nSi no solicitaste este cambio, ignora este correo.`;

    const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'NutriPA'}" <${process.env.EMAIL_USER}>`,
        to: correo,
        subject: ' Código de recuperación - NutriPA',
        text: text,
        html: html
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(` [EMAIL] Correo enviado a ${correo} (ID: ${info.messageId})`);
        return info;
    } catch (error) {
        console.error(' [EMAIL] Error enviando correo:', error.message);
        throw error;
    }
}

// ============================================
//  ENVIAR CONFIRMACIÓN DE CAMBIO EXITOSO
// ============================================
async function sendPasswordUpdatedEmail(correo, nombre) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
</head>
<body style="margin: 0; padding: 0; background: #f4f7fb; font-family: 'Segoe UI', Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding: 20px;">
        <tr>
            <td align="center">
                <table width="500" cellpadding="0" cellspacing="0" style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #10b981, #059669); padding: 30px; text-align: center;">
                            <h1 style="color: white; margin: 0; font-size: 24px;">✅ Contraseña Actualizada</h1>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 30px; text-align: center;">
                            <div style="font-size: 64px; margin: 20px 0;">🎉</div>
                            <p style="color: #6c7293; line-height: 1.6;">
                                Hola <strong>${nombre}</strong>,<br><br>
                                Tu contraseña ha sido actualizada exitosamente.<br>
                                Ya puedes iniciar sesión con tu nueva contraseña.
                            </p>
                            
                            <!-- Advertencia de seguridad -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                <tr>
                                    <td style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 12px 16px; border-radius: 8px;">
                                        <p style="margin: 0; color: #991b1b; font-size: 14px;">
                                             <strong>¿No fuiste tú?</strong><br>
                                            Si no realizaste este cambio, contacta inmediatamente a soporte y bloquea tu cuenta.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
                            <p style="margin: 0; color: #9499b7; font-size: 12px;">
                                © ${new Date().getFullYear()} NutriPA - Sistema Clínico Nutricional
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;

    const text = `Hola ${nombre},\n\nTu contraseña de NutriPA ha sido actualizada exitosamente.\n\nSi no realizaste este cambio, contacta a soporte inmediatamente.`;

    const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'NutriPA'}" <${process.env.EMAIL_USER}>`,
        to: correo,
        subject: ' Contraseña actualizada - NutriPA',
        text: text,
        html: html
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(` [EMAIL] Confirmación enviada a ${correo}`);
        return info;
    } catch (error) {
        console.error(' [EMAIL] Error enviando confirmación:', error.message);
        // No lanzamos error porque no es crítico
    }
}

module.exports = {
    sendRecoveryEmail,
    sendPasswordUpdatedEmail,
    transporter
};