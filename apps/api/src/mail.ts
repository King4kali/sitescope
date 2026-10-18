import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { config, webOrigin } from './config.js';
import { logger } from './http.js';

@Injectable()
export class MailService {
  private readonly transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === 'true',
    connectionTimeout: 5000,
    socketTimeout: 10000,
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } } : {}),
  });
  async sendToken(email: string, token: string, kind: 'VERIFY' | 'RESET') {
    const verify = kind === 'VERIFY';
    const url = `${webOrigin}/${verify ? 'verify-email' : 'reset-password'}?token=${encodeURIComponent(token)}`;
    try {
      await this.transport.sendMail({
        from: config.SMTP_FROM,
        to: email,
        subject: verify ? 'Verify your SiteScope email' : 'Reset your SiteScope password',
        text: `${verify ? 'Verify your email address' : 'Reset your password'} by opening this link:\n\n${url}\n\nThis link expires ${verify ? 'in 24 hours' : 'in one hour'}. If you did not request it, you can ignore this email.`,
      });
    } catch {
      logger.warn(
        { code: 'SMTP_DELIVERY_FAILED', kind },
        'Email delivery failed; the user can request a new link.',
      );
    }
  }
}
