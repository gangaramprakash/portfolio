CREATE DATABASE IF NOT EXISTS prakash_sharing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE prakash_sharing;

CREATE TABLE IF NOT EXISTS submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  topic ENUM('Experience','Thought','Feedback') NOT NULL DEFAULT 'Experience',
  message TEXT NOT NULL,
  preference ENUM('PRIVATE','PUBLIC') NOT NULL DEFAULT 'PRIVATE',
  status ENUM('PRIVATE','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PRIVATE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_status_created (status, created_at)
);
