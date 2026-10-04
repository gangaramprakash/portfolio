require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));


// --------------------------------------------------
// MYSQL DATABASE
// --------------------------------------------------

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'prakash_sharing',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});


// --------------------------------------------------
// RESEND EMAIL
// --------------------------------------------------

const resend = new Resend(process.env.RESEND_API_KEY);


async function sendPrivateSubmissionEmail({
  name,
  email,
  topic,
  message
}) {
  // Check configuration
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      'Private submission saved, but RESEND_API_KEY is missing from .env'
    );

    return false;
  }

  if (!process.env.ADMIN_EMAIL) {
    console.warn(
      'Private submission saved, but ADMIN_EMAIL is missing from .env'
    );

    return false;
  }

  if (!process.env.RESEND_FROM) {
    console.warn(
      'Private submission saved, but RESEND_FROM is missing from .env'
    );

    return false;
  }


  try {
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM,

      to: [process.env.ADMIN_EMAIL],

      replyTo: email,

      subject: `Private message from ${name} — ${topic}`,

      text: `You received a private message through your Sharing & Learning page.

Name: ${name}
Email: ${email}
Topic: ${topic}

Message:
${message}

This message was marked PRIVATE and must not be published without the sender's permission.
`
    });


    if (error) {
      console.error('Resend email error:', error);
      return false;
    }


    console.log(
      'Private submission email sent successfully:',
      data?.id || 'No ID returned'
    );

    return true;

  } catch (error) {

    console.error(
      'Resend connection/error:',
      error
    );

    return false;
  }
}


// --------------------------------------------------
// ADMIN AUTHENTICATION
// --------------------------------------------------

function auth(req, res, next) {

  const header = req.headers.authorization || '';

  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : null;


  if (!token) {
    return res.status(401).json({
      error: 'Authentication required.'
    });
  }


  try {

    req.admin = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    next();

  } catch {

    return res.status(401).json({
      error: 'Invalid or expired admin session.'
    });
  }
}


// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get('/api/health', async (req, res) => {

  try {

    await pool.query('SELECT 1');

    res.json({
      ok: true
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      ok: false,
      error: 'Database connection failed.'
    });
  }
});


// --------------------------------------------------
// SUBMIT EXPERIENCE / THOUGHT / FEEDBACK
// --------------------------------------------------

app.post('/api/submissions', async (req, res) => {

  const {
    name,
    email,
    topic,
    message,
    preference
  } = req.body;


  // Clean input
  const cleanName = String(name || '').trim();

  const cleanEmail = String(email || '').trim();

  const cleanTopic = [
    'Experience',
    'Thought',
    'Feedback'
  ].includes(topic)
    ? topic
    : 'Experience';

  const cleanMessage = String(message || '').trim();

  const cleanPreference =
    preference === 'PUBLIC'
      ? 'PUBLIC'
      : 'PRIVATE';


  // Validation
  if (!cleanName || !cleanEmail || !cleanMessage) {

    return res.status(400).json({
      error: 'Name, email and message are required.'
    });
  }


  // Email validation
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {

    return res.status(400).json({
      error: 'Please enter a valid email address.'
    });
  }


  // Message length
  if (cleanMessage.length > 10000) {

    return res.status(400).json({
      error: 'Message is too long.'
    });
  }


  // Determine status
  const status =
    cleanPreference === 'PUBLIC'
      ? 'PENDING'
      : 'PRIVATE';


  try {

    // Save submission
    const [result] = await pool.execute(

      `INSERT INTO submissions
      (name, email, topic, message, preference, status)
      VALUES (?, ?, ?, ?, ?, ?)`,

      [
        cleanName,
        cleanEmail,
        cleanTopic,
        cleanMessage,
        cleanPreference,
        status
      ]
    );


    // --------------------------------------------------
    // PRIVATE MESSAGE
    // --------------------------------------------------

    let emailSent = false;


    if (cleanPreference === 'PRIVATE') {

      emailSent =
        await sendPrivateSubmissionEmail({

          name: cleanName,

          email: cleanEmail,

          topic: cleanTopic,

          message: cleanMessage
        });
    }


    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    res.status(201).json({

      ok: true,

      id: result.insertId,

      status,

      emailSent,

      message:
        cleanPreference === 'PUBLIC'

          ? 'Your request was sent for approval. It will appear only after Prakash approves it.'

          : emailSent

            ? 'Your message was sent privately to Prakash.'

            : 'Your message was saved privately, but the email notification could not be sent.'
    });


  } catch (err) {

    console.error(
      'Submission database error:',
      err
    );

    res.status(500).json({
      error: 'Could not save the submission.'
    });
  }
});


// --------------------------------------------------
// PUBLISHED STORIES
// --------------------------------------------------

app.get('/api/published', async (req, res) => {

  try {

    const [rows] = await pool.query(

      `SELECT
        id,
        name,
        topic,
        message,
        created_at
       FROM submissions
       WHERE status = 'APPROVED'
       ORDER BY approved_at DESC, id DESC`
    );


    res.json(rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'Could not load published stories.'
    });
  }
});


// --------------------------------------------------
// ADMIN LOGIN
// --------------------------------------------------

app.post('/api/admin/login', (req, res) => {

  const {
    username,
    password
  } = req.body;


  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {

    return res.status(401).json({
      error: 'Invalid username or password.'
    });
  }


  const token = jwt.sign(

    {
      username,
      role: 'admin'
    },

    process.env.JWT_SECRET,

    {
      expiresIn: '8h'
    }
  );


  res.json({
    token
  });
});


// --------------------------------------------------
// ADMIN - GET ALL SUBMISSIONS
// --------------------------------------------------

app.get(
  '/api/admin/submissions',
  auth,
  async (req, res) => {

    try {

      const [rows] = await pool.query(

        `SELECT
          id,
          name,
          email,
          topic,
          message,
          preference,
          status,
          created_at,
          approved_at
         FROM submissions
         ORDER BY id DESC`
      );


      res.json(rows);

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: 'Could not load submissions.'
      });
    }
  }
);


// --------------------------------------------------
// ADMIN - APPROVE / REJECT / PRIVATE
// --------------------------------------------------

app.patch(
  '/api/admin/submissions/:id',
  auth,
  async (req, res) => {

    const id = Number(req.params.id);

    const {
      action
    } = req.body;


    // Validate
    if (
      !Number.isInteger(id) ||
      ![
        'approve',
        'reject',
        'private'
      ].includes(action)
    ) {

      return res.status(400).json({
        error: 'Invalid action.'
      });
    }


    try {

      let sql;

      let params;


      // APPROVE
      if (action === 'approve') {

        sql =
          `UPDATE submissions
           SET
             status = 'APPROVED',
             approved_at = NOW()
           WHERE id = ?
           AND status = 'PENDING'`;

        params = [id];
      }


      // REJECT
      else if (action === 'reject') {

        sql =
          `UPDATE submissions
           SET
             status = 'REJECTED',
             approved_at = NULL
           WHERE id = ?
           AND status = 'PENDING'`;

        params = [id];
      }


      // PRIVATE
      else {

        sql =
          `UPDATE submissions
           SET
             status = 'PRIVATE',
             approved_at = NULL
           WHERE id = ?`;

        params = [id];
      }


      const [result] =
        await pool.execute(
          sql,
          params
        );


      if (!result.affectedRows) {

        return res.status(404).json({
          error:
            'Submission not found or already processed.'
        });
      }


      res.json({
        ok: true
      });


    } catch (err) {

      console.error(err);

      res.status(500).json({
        error:
          'Could not update submission.'
      });
    }
  }
);


// --------------------------------------------------
// ADMIN PAGE
// --------------------------------------------------

app.get('/admin', (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      'admin.html'
    )
  );
});


// --------------------------------------------------
// WEBSITE ROUTES
// --------------------------------------------------

app.get(
  /^\/(?!api(?:\/|$)|admin(?:\/|$)).*/,
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'index.html'
      )
    );
  }
);


// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Sharing system running on port ${PORT}`
    );
  }
);