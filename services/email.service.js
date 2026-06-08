// services/email.service.js
const { Resend } = require('resend');

class EmailService {
    constructor() {
        this.resend = new Resend(process.env.EMAIL_API_KEY);
        this.fromName = process.env.EMAIL_FROM_NAME || 'NutriPA';
        this.fromAddress = process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev';
    }

    // 📧 Enviar código de recuperación
    async sendRecoveryEmail(destinatario, nombreUsuario, codigo) {
        try {
            const { data, error } = await this.resend.emails.send({
                from: `${this.fromName} <${this.fromAddress}>`,
                to: destinatario,
                subject: '🔐 Código de Verificación - NutriPA',
                text: `Hola ${nombreUsuario}, tu código de verificación es: ${codigo}\n\nEste código expira en 15 minutos.\n\nSi no solicitaste este cambio, ignora este mensaje.`,
                html: this._generarTemplateEmail(nombreUsuario, codigo)
            });

            if (error) {
                console.error('❌ [RESEND] Error:', error);
                throw new Error(error.message || 'No se pudo enviar el código');
            }

            console.log(`✅ [EMAIL] Enviado a ${destinatario} - ID: ${data?.id}`);
            return { success: true, messageId: data?.id };

        } catch (err) {
            console.error('❌ [EMAIL] Error enviando recuperación:', err.message);
            throw err;
        }
    }

    // ✅ Enviar confirmación de contraseña actualizada
    async sendPasswordUpdatedEmail(destinatario, nombreUsuario) {
        try {
            const { data, error } = await this.resend.emails.send({
                from: `${this.fromName} <${this.fromAddress}>`,
                to: destinatario,
                subject: '✅ Contraseña Actualizada - NutriPA',
                text: `Hola ${nombreUsuario}, tu contraseña ha sido actualizada exitosamente.\n\nSi no realizaste este cambio, contacta a soporte inmediatamente.`,
                html: this._generarTemplateConfirmacion(nombreUsuario)
            });

            if (error) {
                console.warn('⚠️ [EMAIL] No se pudo enviar confirmación:', error.message);
                // No fallar el proceso principal por esto
                return { success: false };
            }

            console.log(`✅ [EMAIL] Confirmación enviada a ${destinatario}`);
            return { success: true };

        } catch (err) {
            console.warn('⚠️ [EMAIL] Error enviando confirmación:', err.message);
            return { success: false };
        }
    }

    // 🎨 Plantilla HTML para código de recuperación
    _generarTemplateEmail(nombreUsuario, codigo) {
        return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recuperación de Contraseña - NutriPA</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f7fa; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" max-width="600px" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); overflow: hidden;">
                    <tr>
                        <td style="background: linear-gradient(135deg, #6c7293 0%, #3d4468 100%); padding: 40px 32px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">🔐 NutriPA</h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">Recuperación de Contraseña</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px 32px;">
                            <p style="color: #3d4468; font-size: 16px; margin: 0 0 24px;">
                                Hola <strong style="color: #6c7293;">${nombreUsuario}</strong>,
                            </p>
                            <p style="color: #6c7293; font-size: 15px; margin: 0 0 32px; line-height: 1.6;">
                                Hemos recibido una solicitud para restablecer tu contraseña. Usa el siguiente código de verificación para continuar:
                            </p>
                            <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center">
                                        <div style="background: linear-gradient(135deg, #e0e5ec 0%, #f5f7fa 100%); border-radius: 16px; padding: 24px 32px; text-align: center; border: 2px dashed #bec3cf;">
                                            <span style="display: block; color: #3d4468; font-size: 32px; font-weight: 700; letter-spacing: 12px; margin: 0;">${codigo}</span>
                                            <p style="color: #9499b7; font-size: 13px; margin: 12px 0 0;">⏱️ Este código expira en <strong>15 minutos</strong></p>
                                        </div>
                                    </td>
                                </tr>
                            </table>
                            <div style="margin-top: 32px; padding: 20px; background: #f8f9fc; border-radius: 12px;">
                                <p style="color: #6c7293; font-size: 14px; margin: 0; line-height: 1.6;">
                                    <strong>¿No solicitaste este cambio?</strong><br>
                                    Si no fuiste tú, puedes ignorar este mensaje de forma segura.
                                </p>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td style="background: #f8f9fc; padding: 24px 32px; text-align: center; border-top: 1px solid #e0e5ec;">
                            <p style="color: #9499b7; font-size: 12px; margin: 0;">© 2024 NutriPA - Todos los derechos reservados</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
    }

    // 🎨 Plantilla HTML para confirmación
    _generarTemplateConfirmacion(nombreUsuario) {
        return `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; padding: 20px; background: #f5f7fa;">
    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 20px; padding: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
        <h2 style="color: #00c896; text-align: center;">✓ Contraseña Actualizada</h2>
        <p>Hola <strong>${nombreUsuario}</strong>,</p>
        <p>Tu contraseña de <strong>NutriPA</strong> ha sido actualizada exitosamente.</p>
        <p style="color: #6c7293;"><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}</p>
        <hr style="border: none; border-top: 1px solid #e0e5ec; margin: 20px 0;">
        <p style="color: #ff3b5c; font-size: 14px;">
            ⚠️ <strong>¿No fuiste tú?</strong><br>
            Si no realizaste este cambio, tu cuenta podría estar comprometida. 
            Contacta a soporte inmediatamente.
        </p>
        <p style="color: #9499b7; font-size: 12px; text-align: center; margin-top: 30px;">
            © 2024 NutriPA
        </p>
    </div>
</body>
</html>`;
    }
}

module.exports = new EmailService();