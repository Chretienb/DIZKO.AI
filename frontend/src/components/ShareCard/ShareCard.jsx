import React from 'react'
import './shareCard.css'

/**
 * The faded-Polaroid share card (visual only). Rendered to PNG by ShareCardModal
 * via html-to-image. forwardRef so the modal can snapshot the node.
 */
const ShareCard = React.forwardRef(function ShareCard(
  { coverUrl, title, headline, role, handle, url, qrDataUrl, date }, ref) {
  return (
    <div className="dz-card" ref={ref}>
      <div className="dz-grain" />
      <div className="dz-pad">
        <div>
          <div className="dz-brand">dizko<b>.ai</b></div>
          <div className="dz-sub">make it together</div>
        </div>

        <div className="dz-polawrap">
          <div className="dz-pola">
            <div className="dz-tape" />
            <div className="dz-photo">
              {coverUrl
                ? <img src={coverUrl} alt="" crossOrigin="anonymous" />
                : <span className="dz-lab">your cover art</span>}
              <div className="dz-wash" />
            </div>
            <div className="dz-caption">{headline || 'make this with me ✶'}</div>
            <div className="dz-capmeta">
              <span className="dz-date">{date}</span>
              {role && <span className="dz-pill">{role}</span>}
            </div>
          </div>
        </div>

        <div className="dz-foot">
          <div>
            <div className="dz-at">{handle}</div>
            <div className="dz-url">{url}</div>
            <div className="dz-scan">▸ SCAN TO JUMP IN</div>
          </div>
          {qrDataUrl && <div className="dz-qr"><img src={qrDataUrl} alt="QR" /></div>}
        </div>
      </div>
    </div>
  )
})

export default ShareCard
