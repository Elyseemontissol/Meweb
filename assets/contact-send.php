<?php
// contact-send.php

// 1) CONFIG
$to = "Info@MontissolEssentials.com"; // where messages go
$siteName = "Montissol Essentials";
$redirectSuccess = "contact-us.html?sent=1";
$redirectFail    = "contact-us.html?error=1";

// 2) Only accept POST
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
  header("Location: $redirectFail");
  exit;
}

// 3) Honeypot (spam trap)
$honeypot = trim($_POST["company"] ?? "");
if ($honeypot !== "") {
  // Bot likely filled hidden field
  header("Location: $redirectSuccess");
  exit;
}

// 4) Collect + sanitize
$name    = trim($_POST["name"] ?? "");
$email   = trim($_POST["email"] ?? "");
$phone   = trim($_POST["phone"] ?? "");
$companyName = trim($_POST["meta_companyName"] ?? "");
$subject = trim($_POST["subject"] ?? "");
$message = trim($_POST["message"] ?? "");

// 5) Validate
if ($name === "" || $email === "" || $subject === "" || $message === "") {
  header("Location: $redirectFail");
  exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
  header("Location: $redirectFail");
  exit;
}

// Prevent header injection
$subject = preg_replace("/[\r\n]+/", " ", $subject);
$name    = preg_replace("/[\r\n]+/", " ", $name);

// 6) Build email
$ip = $_SERVER["REMOTE_ADDR"] ?? "unknown";
$ua = $_SERVER["HTTP_USER_AGENT"] ?? "unknown";

$body = "New message from $siteName contact form\n\n";
$body .= "Name: $name\n";
$body .= "Email: $email\n";
$body .= "Phone: " . ($phone !== "" ? $phone : $companyName = trim($_POST["meta_companyName"] ?? "");
$body .= "Subject: $subject\n\n";
$body .= "Message:\n$message\n\n";
$body .= "----\n";
$body .= "IP: $ip\n";
$body .= "User-Agent: $ua\n";

// IMPORTANT: Use Reply-To so you can reply directly to the user
$headers = [];
$headers[] = "MIME-Version: 1.0";
$headers[] = "Content-Type: text/plain; charset=UTF-8";
$headers[] = "From: $siteName <no-reply@" . $_SERVER["SERVER_NAME"] . ">";
$headers[] = "Reply-To: $name <$email>";

// 7) Send
$ok = mail($to, "Contact Form: $subject", $body, implode("\r\n", $headers));

header("Location: " . ($ok ? $redirectSuccess : $redirectFail));
exit;