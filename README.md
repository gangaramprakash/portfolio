# Prakash Sharing & Approval System

This adds a real approval workflow to the existing portfolio.

## Flow

- **Send to Prakash privately** → stored as `PRIVATE`; it is never shown on the public site.
- **Display on the website** → stored as `PENDING`; it is NOT published yet.
- Prakash opens `/admin`, logs in, reviews the request, and clicks **Approve & Publish**.
- Only `APPROVED` submissions are returned by `/api/published` and rendered on `sharing.html`.
- Rejecting a request changes it to `REJECTED` and it stays off the public site.

## Setup

1. Install Node.js and MySQL.
2. Create the database/tables by running `schema.sql` in MySQL Workbench.
3. Copy `.env.example` to `.env` and set the MySQL password, admin username/password, and a long JWT secret.
4. Run:

```bash
npm install
npm start
```

5. Open `http://localhost:3000`.
6. Open `http://localhost:3000/sharing.html` for visitors.
7. Open `http://localhost:3000/admin` for approval.

## Important

Do not commit `.env` to GitHub. Add `.env` to `.gitignore` before pushing the project.

For a live deployment, host the Node.js backend on a server that supports Node + MySQL. GitHub Pages alone cannot run this backend.
