# Private submission email update

This update adds email notification for PRIVATE submissions.

## Files
- `server.js` — saves the submission and sends the private-message email.
- `package.json` — adds Nodemailer.
- `.env.example` — adds SMTP settings.

## Install
Run in the project folder:

```powershell
npm install
```

## Gmail setup
For Gmail, use:
- SMTP_HOST=smtp.gmail.com
- SMTP_PORT=587
- SMTP_SECURE=false
- SMTP_USER=your Gmail address
- SMTP_PASSWORD=your Google App Password
- ADMIN_EMAIL=the Gmail address that should receive private messages
- SMTP_FROM=your Gmail address

Do not use your normal Gmail password. Use a Google App Password.

Keep `.env` out of GitHub.
