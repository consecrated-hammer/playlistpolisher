import React from 'react';

const TermsPage = () => {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl p-8 border border-spotify-gray-mid/60">
        <h1 className="text-3xl font-bold text-white mb-6">Terms of Service</h1>
        <div className="space-y-6 text-spotify-gray-light">
          <p className="text-sm text-spotify-gray-light">Last Updated: December 16, 2025</p>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing and using Playlist Polisher ("the Service"), you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. Description of Service</h2>
            <p>
              Playlist Polisher provides tools to organize, sort, and manage your Spotify playlists. The Service connects 
              to your Spotify account with your explicit authorization and performs actions on your behalf according to 
              your instructions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. User Accounts and Authorization</h2>
            <p className="mb-2">
              To use the Service, you must:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Have a valid Spotify account</li>
              <li>Authorize Playlist Polisher to access your Spotify data</li>
              <li>Comply with Spotify's Terms of Service</li>
              <li>Not use the Service for any unlawful purpose</li>
            </ul>
            <p className="mt-2">
              You may revoke access at any time through your Spotify account settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. User Responsibilities</h2>
            <p className="mb-2">You agree to:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Use the Service only for its intended purpose</li>
              <li>Not attempt to circumvent any security measures</li>
              <li>Not abuse, harass, or harm the Service or its users</li>
              <li>Review changes before applying them to your playlists</li>
              <li>Maintain the security of your Spotify account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Disclaimer of Warranties</h2>
            <p>
              THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DO NOT GUARANTEE 
              THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE FROM HARMFUL COMPONENTS. USE OF THE SERVICE 
              IS AT YOUR OWN RISK.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, PLAYLIST POLISHER SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, 
              SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF DATA, REVENUE, OR PROFITS ARISING FROM YOUR 
              USE OF THE SERVICE.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Modifications to Service</h2>
            <p>
              We reserve the right to modify, suspend, or discontinue the Service at any time with or without notice. 
              We may also update these Terms of Service periodically. Continued use of the Service constitutes acceptance 
              of any changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Third-Party Services</h2>
            <p>
              The Service integrates with Spotify. Your use of Spotify is governed by Spotify's own Terms of Service. 
              We are not responsible for Spotify's services, availability, or policies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">8. Termination</h2>
            <p>
              We may terminate or suspend your access to the Service immediately, without notice, for any breach of 
              these Terms. Upon termination, your right to use the Service will cease immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">9. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of your jurisdiction, without 
              regard to its conflict of law provisions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">10. Contact</h2>
            <p>
              For questions about these Terms, please contact us through our support channels.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default TermsPage;
