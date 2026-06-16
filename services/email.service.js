// services/email.service.js
// services/email.service.js
const nodemailer = require('nodemailer');

// Configurar transporter de Gmail
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // true para 465, false para 587
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Verificar conexión al iniciar
transporter.verify()
    .then(() => console.log('✅ [EMAIL] Servicio de correo configurado correctamente'))
    .catch(err => console.error('❌ [EMAIL] Error configurando correo:', err.message));

// ============================================
// 📧 Enviar código de recuperación
// ============================================
async function sendRecoveryEmail(correo, nombre, codigo) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f7fb; margin: 0; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        .header { background: linear-gradient(135deg, #0a4d68, #145da0); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .header p { margin: 8px 0 0; opacity: 0.9; }
        .content { padding: 30px; }
        .greeting { font-size: 18px; color: #1a1f36; margin-bottom: 16px; }
        .message { color: #6c7293; line-height: 1.6; margin-bottom: 24px; }
        .code-box { background: #f4f7fb; border: 2px dashed #145da0; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
        .code { font-size: 36px; font-weight: 700; color: #0a4d68; letter-spacing: 8px; font-family: 'Courier New', monospace; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; border-radius: 8px; margin: 20px 0; color: #856404; font-size: 14px; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; color: #9499b7; font-size: 12px; border-top: 1px solid #e2e8f0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Recuperación de Contraseña</h1>
            <p>NutriPA - Sistema Clínico Nutricional</p>
        </div>
        <div class="content">
            <p class="greeting">Hola ${nombre},</p>
            <p class="message">
                Hemos recibido una solicitud para restablecer tu contraseña. 
                Usa el siguiente código de verificación:
            </p>
            <div class="code-box">
                <div class="code">${codigo}</div>
            </div>
            <div class="warning">
                ⚠️ <strong>Importante:</strong> Este código expira en <strong>15 minutos</strong>. 
                Si no solicitaste este cambio, ignora este correo.
            </div>
            <p class="message" style="font-size: 14px;">
                Por seguridad, nunca compartas este código con nadie.
            </p>
        </div>
        <div class="footer">
            <p>Este correo fue enviado automáticamente por NutriPA.</p>
            <p>© ${new Date().getFullYear()} NutriPA - Todos los derechos reservados</p>
        </div>
    </div>
</body>
</html>
    `;

    const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'NutriPA'}" <${process.env.EMAIL_USER}>`,
        to: correo,
        subject: '🔐 Código de recuperación - NutriPA',
        text: `Hola ${nombre}, tu código de recuperación es: ${codigo}\n\nEste código expira en 15 minutos.`,
        html: html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ [EMAIL] Correo enviado a ${correo} (ID: ${info.messageId})`);
    return info;
}

// ============================================
// ✅ Enviar confirmación de cambio exitoso
// ============================================
async function sendPasswordUpdatedEmail(correo, nombre) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f7fb; margin: 0; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 30px; }
        .success-icon { font-size: 64px; text-align: center; margin: 20px 0; }
        .message { color: #6c7293; line-height: 1.6; text-align: center; }
        .warning { background: #fee2e2; border-left: 4px solid #dc2626; padding: 12px 16px; border-radius: 8px; margin: 20px 0; color: #991b1b; font-size: 14px; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; color: #9499b7; font-size: 12px; border-top: 1px solid #e2e8f0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ Contraseña Actualizada</h1>
        </div>
        <div class="content">
            <div class="success-icon">🎉</div>
            <p class="message">
                Hola <strong>${nombre}</strong>,<br><br>
                Tu contraseña ha sido actualizada exitosamente.<br>
                Ya puedes iniciar sesión con tu nueva contraseña.
            </p>
            <div class="warning">
                🚨 <strong>¿No fuiste tú?</strong><br>
                Si no realizaste este cambio, contacta inmediatamente a soporte y bloquea tu cuenta.
            </div>
        </div>
        <div class="footer">
            <p>© ${new Date().getFullYear()} NutriPA - Sistema Clínico Nutricional</p>
        </div>
    </div>
</body>
</html>
    `;

    const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'NutriPA'}" <${process.env.EMAIL_USER}>`,
        to: correo,
        subject: '✅ Contraseña actualizada - NutriPA',
        text: `Hola ${nombre}, tu contraseña ha sido actualizada exitosamente.`,
        html: html
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ [EMAIL] Confirmación enviada a ${correo}`);
}

module.exports = {
    sendRecoveryEmail,
    sendPasswordUpdatedEmail,
    transporter
};