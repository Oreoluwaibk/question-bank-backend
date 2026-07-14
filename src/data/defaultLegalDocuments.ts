export type LegalSection = {
  title: string;
  body: string[];
};

export type LegalDocumentContent = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
};

export type LegalSlug = "terms" | "privacy";

export const DEFAULT_TERMS: LegalDocumentContent = {
  title: "Terms & Conditions",
  lastUpdated: "July 14, 2026",
  intro:
    'These Terms & Conditions ("Terms") govern your access to and use of the Question Bank mobile application and related services (the "Service") operated by Question Bank ("we", "us", or "our"). By creating an account or using the Service, you agree to these Terms.',
  sections: [
    {
      title: "1. About the Service",
      body: [
        "Question Bank helps you upload study materials (such as PDF and DOCX files), extract and generate practice questions, organize them into materials, take timed tests, and track your performance.",
        "The Service may use automated tools, including artificial intelligence, to process uploaded content and generate questions. Generated content is provided for study and revision purposes only.",
      ],
    },
    {
      title: "2. Eligibility & Account Registration",
      body: [
        "You must provide accurate information when registering, including your name, email address, and phone number.",
        "You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account.",
        "You must verify your email address using the one-time code we send before your account is fully activated.",
        "You may sign in with email and password or, where available, through supported third-party providers such as Google.",
        "We may limit concurrent active sessions per account (for example, two devices at a time) to protect account security.",
      ],
    },
    {
      title: "3. Acceptable Use",
      body: [
        "You agree to use the Service only for lawful educational and personal study purposes.",
        "You must not upload content that infringes copyright or other intellectual property rights, contains malware, or includes unlawful, harmful, or abusive material.",
        "You must not attempt to reverse engineer, disrupt, scrape, or overload the Service, or access accounts that are not yours.",
        "You must not misuse AI-generated questions as official exam papers, certified assessments, or professional qualifications without independent verification.",
      ],
    },
    {
      title: "4. Your Content",
      body: [
        'You retain ownership of documents, questions, and other content you upload or create ("User Content").',
        "By uploading User Content, you grant us a limited license to store, process, and display it solely to operate and improve the Service, including generating questions from your materials.",
        "You represent that you have the rights necessary to upload and use your User Content within the Service.",
        "We may remove content that violates these Terms or applicable law.",
      ],
    },
    {
      title: "5. AI-Generated Content Disclaimer",
      body: [
        "Questions and answers generated or extracted by the Service may contain errors, omissions, or inaccuracies.",
        "You are responsible for reviewing generated content before relying on it for study, teaching, or assessment.",
        "We do not guarantee that generated questions match any official syllabus, exam board, or institution requirements.",
      ],
    },
    {
      title: "6. Subscriptions & Payments",
      body: [
        "Some features are available on a free tier with usage limits. Paid plans (such as Pro) may offer higher limits and additional features.",
        "If you subscribe to a paid plan, payments are processed by our payment partner (Paystack). By subscribing, you also agree to applicable payment provider terms.",
        "Subscription fees, billing intervals, and included features are shown in the app before checkout.",
        "You may cancel a subscription through the app where cancellation is supported. Cancellation typically stops future renewals; access may continue until the end of the current billing period unless stated otherwise.",
        "Except where required by law, fees already paid are non-refundable.",
      ],
    },
    {
      title: "7. Intellectual Property",
      body: [
        "The Service, including its design, branding, software, and documentation, is owned by us or our licensors and is protected by applicable intellectual property laws.",
        "These Terms do not grant you any rights to our trademarks, logos, or proprietary materials except as needed to use the Service.",
      ],
    },
    {
      title: "8. Third-Party Services",
      body: [
        "The Service relies on third-party providers for authentication, storage, analytics, payments, and AI processing. Your use of those features may be subject to their respective terms and policies.",
        "We are not responsible for third-party services outside our reasonable control.",
      ],
    },
    {
      title: "9. Suspension & Termination",
      body: [
        "We may suspend or terminate your access if you breach these Terms, misuse the Service, or if required by law.",
        "You may stop using the Service at any time. You may request account deletion by contacting us.",
        "Sections that by nature should survive termination (including disclaimers, limitations of liability, and governing law) will continue to apply.",
      ],
    },
    {
      title: "10. Disclaimers & Limitation of Liability",
      body: [
        'The Service is provided on an "as is" and "as available" basis without warranties of any kind, whether express or implied.',
        "To the fullest extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or for loss of data, profits, or study outcomes arising from your use of the Service.",
        "Our total liability for any claim relating to the Service is limited to the amount you paid us in the twelve (12) months before the claim, or zero if you used the free tier.",
      ],
    },
    {
      title: "11. Changes to These Terms",
      body: [
        'We may update these Terms from time to time. When we do, we will update the "Last updated" date and may notify you through the app or by email.',
        "Continued use of the Service after changes become effective constitutes acceptance of the revised Terms.",
      ],
    },
    {
      title: "12. Governing Law & Contact",
      body: [
        "These Terms are governed by the laws of the Federal Republic of Nigeria, without regard to conflict-of-law principles, unless mandatory local law requires otherwise.",
        "If you have questions about these Terms, contact us at oreoluwa.creatives@gmail.com.",
      ],
    },
  ],
};

export const DEFAULT_PRIVACY: LegalDocumentContent = {
  title: "Privacy Policy",
  lastUpdated: "July 14, 2026",
  intro:
    'This Privacy Policy explains how Question Bank ("we", "us", or "our") collects, uses, shares, and protects personal information when you use our mobile application and related services (the "Service").',
  sections: [
    {
      title: "1. Information We Collect",
      body: [
        "Account information: name, email address, phone number, password (stored in hashed form by our authentication provider), and profile details you choose to provide.",
        "Profile information: optional fields such as field of study, occupation, and profile photo.",
        "Study content: documents you upload, extracted text, generated questions, materials, test attempts, scores, and analytics derived from your usage.",
        "Device and session information: device identifiers, device name, app version, and session tokens used to keep you signed in and enforce session limits.",
        "Payment information: subscription status and billing metadata. Payment card details are handled by Paystack and are not stored directly by us.",
        "Usage data: actions you take in the app, such as uploads, tests taken, and feature usage, to operate and improve the Service.",
      ],
    },
    {
      title: "2. How We Use Information",
      body: [
        "To create and manage your account, authenticate you, and provide customer support.",
        "To process uploaded materials and generate or extract practice questions.",
        "To run test mode, store your answers, calculate scores, and show performance history.",
        "To enforce plan limits, manage subscriptions, and process payments.",
        "To maintain security, prevent fraud, and enforce our Terms & Conditions.",
        "To improve reliability, fix bugs, and develop new features.",
      ],
    },
    {
      title: "3. AI Processing",
      body: [
        "When you upload study materials, relevant text may be sent to AI services to extract or generate questions.",
        "We use these tools to deliver core functionality. You should avoid uploading sensitive personal data unrelated to your study materials.",
        "AI providers process data according to their own policies and our agreements with them.",
      ],
    },
    {
      title: "4. How We Share Information",
      body: [
        "We share information with service providers that help us operate the Service, including hosting, authentication, payment processing, and AI processing partners.",
        "We may disclose information if required by law, court order, or to protect the rights, safety, and security of users and the Service.",
        "We do not sell your personal information.",
        "Leaderboard or analytics features may show aggregated or non-sensitive performance data. Where identifiable information is shown, it is limited to what is necessary for the feature.",
      ],
    },
    {
      title: "5. Data Retention",
      body: [
        "We retain account and study data for as long as your account is active or as needed to provide the Service.",
        "If you delete your account or request deletion, we will delete or anonymize personal information within a reasonable period, except where retention is required by law or for legitimate business purposes such as billing records.",
      ],
    },
    {
      title: "6. Security",
      body: [
        "We use administrative, technical, and organizational measures designed to protect your information, including encrypted connections and access controls.",
        "No method of transmission or storage is completely secure. You are responsible for safeguarding your account credentials.",
      ],
    },
    {
      title: "7. Your Choices & Rights",
      body: [
        "You may update profile information in the app.",
        "You may manage upload preferences and certain app settings locally on your device.",
        "Depending on your location, you may have rights to access, correct, delete, or restrict processing of your personal information.",
        "To exercise privacy rights or request account deletion, contact us at oreoluwa.creatives@gmail.com.",
      ],
    },
    {
      title: "8. Children's Privacy",
      body: [
        "The Service is not directed to children under 13 (or the minimum age required in your jurisdiction) without parental consent.",
        "If you believe a child has provided personal information without appropriate consent, contact us so we can take appropriate action.",
      ],
    },
    {
      title: "9. International Transfers",
      body: [
        "Your information may be processed in countries other than your own, including where our service providers operate.",
        "We take steps designed to ensure appropriate safeguards when data is transferred internationally.",
      ],
    },
    {
      title: "10. Changes to This Policy",
      body: [
        'We may update this Privacy Policy from time to time. We will update the "Last updated" date and may provide additional notice for material changes.',
        "Your continued use of the Service after an update means you accept the revised policy.",
      ],
    },
    {
      title: "11. Contact Us",
      body: [
        "If you have questions about this Privacy Policy or our data practices, contact us at oreoluwa.creatives@gmail.com.",
      ],
    },
  ],
};

export const DEFAULT_LEGAL_BY_SLUG: Record<LegalSlug, LegalDocumentContent> = {
  terms: DEFAULT_TERMS,
  privacy: DEFAULT_PRIVACY,
};
