require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const admin = require('firebase-admin');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================================================
// MIDDLEWARE
// ==================================================

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ==================================================
// FIREBASE FIRESTORE
// ==================================================

if (
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !process.env.FIREBASE_PRIVATE_KEY
) {
    console.error('Firebase environment variables are missing.');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
});

const db = admin.firestore();
const submissionsCollection = db.collection('submissions');

// ==================================================
// RESEND EMAIL
// ==================================================

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendPrivateSubmissionEmail({
    name,
    email,
    topic,
    message
}) {
    if (
        !process.env.RESEND_API_KEY ||
        !process.env.ADMIN_EMAIL ||
        !process.env.RESEND_FROM
    ) {
        console.warn(
            'Private submission saved, but email configuration is incomplete.'
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

This message was marked PRIVATE and must not be published without the sender's permission.`
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
        console.error('Resend connection/error:', error);
        return false;
    }
}

// ==================================================
// ADMIN AUTHENTICATION
// ==================================================

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
        req.admin = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({
            error: 'Invalid or expired admin session.'
        });
    }
}

// ==================================================
// FIRESTORE DATA SERIALIZATION
// ==================================================

function convertTimestamp(value) {
    if (!value) return null;

    if (typeof value.toDate === 'function') {
        return value.toDate().toISOString();
    }

    return value;
}

function serializeSubmission(doc) {
    const data = doc.data();

    return {
        id: doc.id,
        name: data.name || '',
        email: data.email || '',
        topic: data.topic || '',
        message: data.message || '',
        preference: data.preference || '',
        status: data.status || '',
        created_at: convertTimestamp(data.created_at),
        updated_at: convertTimestamp(data.updated_at),
        approved_at: convertTimestamp(data.approved_at)
    };
}

// ==================================================
// HEALTH CHECK
// ==================================================

app.get('/api/health', async (req, res) => {
    try {
        await submissionsCollection.limit(1).get();

        return res.json({
            ok: true,
            database: 'Firestore'
        });
    } catch (error) {
        console.error('Firestore health check error:', error);

        return res.status(500).json({
            ok: false,
            error: 'Firestore connection failed.'
        });
    }
});

// ==================================================
// SUBMIT EXPERIENCE / THOUGHT / FEEDBACK
// ==================================================

app.post('/api/submissions', async (req, res) => {
    const {
        name,
        email,
        topic,
        message,
        preference
    } = req.body;

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

    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        return res.status(400).json({
            error: 'Please enter a valid email address.'
        });
    }

    if (cleanMessage.length > 10000) {
        return res.status(400).json({
            error: 'Message is too long.'
        });
    }

    const status =
        cleanPreference === 'PUBLIC'
            ? 'PENDING'
            : 'PRIVATE';

    try {
        // Save submission in Firestore
        const docRef = await submissionsCollection.add({
            name: cleanName,
            email: cleanEmail,
            topic: cleanTopic,
            message: cleanMessage,
            preference: cleanPreference,
            status: status,
            created_at:
                admin.firestore.FieldValue.serverTimestamp(),
            updated_at:
                admin.firestore.FieldValue.serverTimestamp(),
            approved_at: null
        });

        // Send email only for private submissions
        let emailSent = false;

        if (cleanPreference === 'PRIVATE') {
            emailSent = await sendPrivateSubmissionEmail({
                name: cleanName,
                email: cleanEmail,
                topic: cleanTopic,
                message: cleanMessage
            });
        }

        return res.status(201).json({
            ok: true,
            id: docRef.id,
            status: status,
            emailSent: emailSent,
            message:
                cleanPreference === 'PUBLIC'
                    ? 'Your request was sent for approval. It will appear only after Prakash approves it.'
                    : emailSent
                        ? 'Your message was sent privately to Prakash.'
                        : 'Your message was saved privately, but the email notification could not be sent.'
        });

    } catch (error) {
        console.error('Firestore submission error:', error);

        return res.status(500).json({
            error: 'Could not save the submission.'
        });
    }
});

// ==================================================
// PUBLISHED STORIES
// Only APPROVED submissions are public
// ==================================================

app.get('/api/published', async (req, res) => {
    try {
        const snapshot = await submissionsCollection
            .where('status', '==', 'APPROVED')
            .get();

        const rows = snapshot.docs
            .map(serializeSubmission)
            .sort((a, b) => {
                const dateA = a.approved_at
                    ? new Date(a.approved_at).getTime()
                    : 0;

                const dateB = b.approved_at
                    ? new Date(b.approved_at).getTime()
                    : 0;

                return dateB - dateA;
            });

        return res.json(rows);

    } catch (error) {
        console.error('Published submissions error:', error);

        return res.status(500).json({
            error: 'Could not load published stories.'
        });
    }
});

// ==================================================
// ADMIN LOGIN
// ==================================================

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    if (
        username !== process.env.ADMIN_USERNAME ||
        password !== process.env.ADMIN_PASSWORD
    ) {
        return res.status(401).json({
            error: 'Invalid username or password.'
        });
    }

    if (!process.env.JWT_SECRET) {
        console.error('JWT_SECRET is missing.');

        return res.status(500).json({
            error: 'Server authentication is not configured.'
        });
    }

    const token = jwt.sign(
        {
            username: username,
            role: 'admin'
        },
        process.env.JWT_SECRET,
        {
            expiresIn: '8h'
        }
    );

    return res.json({ token });
});

// ==================================================
// ADMIN: GET ALL SUBMISSIONS
// ==================================================

app.get('/api/admin/submissions', auth, async (req, res) => {
    try {
        const snapshot = await submissionsCollection.get();

        const rows = snapshot.docs
            .map(serializeSubmission)
            .sort((a, b) => {
                const dateA = a.created_at
                    ? new Date(a.created_at).getTime()
                    : 0;

                const dateB = b.created_at
                    ? new Date(b.created_at).getTime()
                    : 0;

                return dateB - dateA;
            });

        return res.json(rows);

    } catch (error) {
        console.error('Admin submissions error:', error);

        return res.status(500).json({
            error: 'Could not load submissions.'
        });
    }
});

// ==================================================
// ADMIN: APPROVE / REJECT / MAKE PRIVATE
// ==================================================

app.patch('/api/admin/submissions/:id', auth, async (req, res) => {
    const id = String(req.params.id || '').trim();
    const { action } = req.body;

    if (
        !id ||
        !['approve', 'reject', 'private'].includes(action)
    ) {
        return res.status(400).json({
            error: 'Invalid action.'
        });
    }

    try {
        const docRef = submissionsCollection.doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({
                error: 'Submission not found.'
            });
        }

        const currentData = doc.data();

        if (action === 'approve') {
            if (currentData.status !== 'PENDING') {
                return res.status(409).json({
                    error: 'Submission is not pending or has already been processed.'
                });
            }

            await docRef.update({
                status: 'APPROVED',
                approved_at:
                    admin.firestore.FieldValue.serverTimestamp(),
                updated_at:
                    admin.firestore.FieldValue.serverTimestamp()
            });

        } else if (action === 'reject') {
            if (currentData.status !== 'PENDING') {
                return res.status(409).json({
                    error: 'Submission is not pending or has already been processed.'
                });
            }

            await docRef.update({
                status: 'REJECTED',
                approved_at: null,
                updated_at:
                    admin.firestore.FieldValue.serverTimestamp()
            });

        } else {
            await docRef.update({
                status: 'PRIVATE',
                approved_at: null,
                updated_at:
                    admin.firestore.FieldValue.serverTimestamp()
            });
        }

        return res.json({ ok: true });

    } catch (error) {
        console.error('Admin update error:', error);

        return res.status(500).json({
            error: 'Could not update submission.'
        });
    }
});

// ==================================================
// ADMIN PAGE
// ==================================================

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ==================================================
// MAIN WEBSITE
// ==================================================

app.get(
    /^\/(?!api(?:\/|$)|admin(?:\/|$)).*/,
    (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    }
);

// ==================================================
// START SERVER
// ==================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sharing system running on port ${PORT}`);
    console.log('Database: Firebase Firestore');
});
