import React from 'react';

const PrivacyPage = () => {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl p-8 border border-spotify-gray-mid/60">
        <h1 className="text-3xl font-bold text-white mb-6">Privacy Policy</h1>
        <div className="space-y-6 text-spotify-gray-light">
          <p className="text-sm text-spotify-gray-light">Last Updated: December 16, 2025</p>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Introduction</h2>
            <p>
              Playlist Polisher ("we", "us", "our") respects your privacy and is committed to protecting your personal data. 
              This Privacy Policy explains how we collect, use, and safeguard your information when you use our Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. Information We Collect</h2>
            
            <h3 className="text-lg font-medium text-white mt-4 mb-2">2.1 Spotify Account Information</h3>
            <p className="mb-2">When you authorize Playlist Polisher, we collect:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Your Spotify user ID and display name</li>
              <li>Your email address</li>
              <li>Your profile image</li>
              <li>Your playlists and their contents</li>
              <li>Information about tracks in your playlists</li>
            </ul>
            <p className="mt-2 text-sm">
              <strong className="text-white">Important:</strong> Spotify authentication is handled entirely by Spotify's secure 
              OAuth system. We never see or store your Spotify password.
            </p>

            <h3 className="text-lg font-medium text-white mt-4 mb-2">2.2 Usage Information</h3>
            <p className="mb-2">We automatically collect:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Actions you perform in the Service (sorts, edits, deletions)</li>
              <li>Features you use and how often</li>
              <li>Error logs and diagnostic information</li>
              <li>Browser type and IP address</li>
            </ul>

            <h3 className="text-lg font-medium text-white mt-4 mb-2">2.3 Email and Communication</h3>
            <p>
              Your email address is used solely for account management and service notifications. We do not share your 
              email with third parties for marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. How We Use Your Information</h2>
            <p className="mb-2">We use your information to:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Provide and maintain the Service</li>
              <li>Perform operations on your Spotify playlists as you request</li>
              <li>Improve and optimize the Service</li>
              <li>Communicate with you about the Service</li>
              <li>Detect and prevent technical issues or abuse</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Data Storage and Security</h2>
            <p>
              Your Spotify access tokens are stored securely on our servers. We implement industry-standard security 
              measures including encryption, secure connections (HTTPS), and access controls. However, no method of 
              transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Data Sharing and Third Parties</h2>
            <p className="mb-2">We do not sell your personal data. We may share your information with:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li><strong>Spotify:</strong> We communicate with Spotify's API on your behalf to perform requested actions</li>
              <li><strong>Service Providers:</strong> Third-party services that help us operate (hosting, analytics)</li>
              <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Your Rights and Choices</h2>
            <p className="mb-2">You have the right to:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li><strong>Access:</strong> Request a copy of your data</li>
              <li><strong>Correction:</strong> Request correction of inaccurate data</li>
              <li><strong>Deletion:</strong> Request deletion of your data</li>
              <li><strong>Revocation:</strong> Revoke access at any time through your Spotify account settings</li>
              <li><strong>Objection:</strong> Object to processing of your data</li>
              <li><strong>Portability:</strong> Request your data in a machine-readable format</li>
            </ul>
            <p className="mt-2">
              To exercise these rights, please contact us through our support channels.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Cookies and Tracking</h2>
            <p>
              We use session cookies to maintain your authentication state. These cookies are essential for the Service 
              to function and expire when you log out or close your browser. We do not use third-party tracking cookies 
              for advertising purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">8. Data Retention</h2>
            <p>
              We retain your data for as long as you use the Service or as necessary to fulfill the purposes outlined 
              in this policy. When you revoke access to your Spotify account, we delete your access tokens immediately. 
              Other data may be retained for a limited period for backup, legal, or operational purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">9. International Data Transfers</h2>
            <p>
              Your information may be transferred to and processed in countries other than your own. We ensure appropriate 
              safeguards are in place to protect your data in accordance with applicable data protection laws.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">10. Children's Privacy</h2>
            <p>
              The Service is not intended for users under 13 years of age. We do not knowingly collect personal 
              information from children under 13. If you believe we have collected such information, please contact us 
              immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">11. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy periodically. We will notify you of significant changes by posting the 
              new policy on this page and updating the "Last Updated" date. Your continued use of the Service after 
              changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">12. GDPR Compliance (EU Users)</h2>
            <p>
              If you are in the European Union, you have additional rights under the General Data Protection Regulation 
              (GDPR), including the right to lodge a complaint with a supervisory authority.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">13. CCPA Compliance (California Users)</h2>
            <p>
              If you are a California resident, you have rights under the California Consumer Privacy Act (CCPA), 
              including the right to know what personal information we collect and the right to opt-out of the sale 
              of your information (we do not sell personal information).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">14. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy or our data practices, please contact us through our 
              support channels.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPage;
