const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

async function sendLeaveNotification({ adminEmails, employee, leaveRequest }) {
  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not set — skipping notification');
    return;
  }

  const isAnnual   = leaveRequest.type === 'annual';
  const typeLabel  = isAnnual ? 'Annual Leave' : 'Medical Leave';
  const statusNote = isAnnual
    ? 'This request requires your approval.'
    : 'This has been automatically approved.';

  const dateRange = leaveRequest.start_date === leaveRequest.end_date
    ? formatDate(leaveRequest.start_date)
    : `${formatDate(leaveRequest.start_date)} → ${formatDate(leaveRequest.end_date)}`;

  const subject = isAnnual
    ? `Leave Request — ${employee.name} (${leaveRequest.days_count} day${leaveRequest.days_count !== 1 ? 's' : ''})`
    : `Medical Leave Filed — ${employee.name}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f2f8; margin: 0; padding: 32px 0; }
        .wrapper { max-width: 560px; margin: 0 auto; }
        .card { background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        .header { background: linear-gradient(135deg, #1a1640 0%, #2d2475 100%); padding: 28px 32px; }
        .header-logo { display: flex; align-items: center; gap: 10px; }
        .header h1 { color: white; font-size: 18px; font-weight: 700; margin: 0; }
        .header p  { color: rgba(255,255,255,0.6); font-size: 13px; margin: 4px 0 0; }
        .body { padding: 28px 32px; }
        .alert-box {
          background: ${isAnnual ? '#eef2ff' : '#fee2e2'};
          border-left: 4px solid ${isAnnual ? '#4f46e5' : '#ef4444'};
          border-radius: 8px; padding: 14px 16px; margin-bottom: 24px;
          font-size: 14px; color: ${isAnnual ? '#3730a3' : '#991b1b'}; font-weight: 600;
        }
        .detail-row { display: flex; justify-content: space-between; padding: 11px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #64748b; }
        .detail-value { font-weight: 600; color: #0f172a; text-align: right; max-width: 60%; }
        .cta { text-align: center; margin-top: 24px; }
        .cta a {
          display: inline-block; background: #4f46e5; color: white;
          text-decoration: none; padding: 12px 28px; border-radius: 9px;
          font-weight: 700; font-size: 14px;
        }
        .footer { padding: 18px 32px; background: #f8fafc; border-top: 1px solid #e8eaf0; text-align: center; }
        .footer p { font-size: 11px; color: #94a3b8; margin: 0; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="card">
          <div class="header">
            <div class="header-logo">
              <div style="width:36px;height:36px;background:rgba(255,255,255,0.15);border-radius:9px;display:flex;align-items:center;justify-content:center">
                <span style="font-size:18px">📅</span>
              </div>
              <div>
                <h1>Leave Tracker</h1>
                <p>New ${typeLabel} Request</p>
              </div>
            </div>
          </div>

          <div class="body">
            <div class="alert-box">${statusNote}</div>

            <div class="detail-row">
              <span class="detail-label">Employee</span>
              <span class="detail-value">${employee.name}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Department</span>
              <span class="detail-value">${employee.department || '—'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Leave Type</span>
              <span class="detail-value">${typeLabel}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Date(s)</span>
              <span class="detail-value">${dateRange}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Duration</span>
              <span class="detail-value">${leaveRequest.days_count} working day${leaveRequest.days_count !== 1 ? 's' : ''}</span>
            </div>
            ${leaveRequest.reason ? `
            <div class="detail-row">
              <span class="detail-label">Reason</span>
              <span class="detail-value">${leaveRequest.reason}</span>
            </div>` : ''}
            ${leaveRequest.mc_note ? `
            <div class="detail-row">
              <span class="detail-label">MC Details</span>
              <span class="detail-value">${leaveRequest.mc_note}</span>
            </div>` : ''}

            ${isAnnual ? `
            <div class="cta">
              <a href="${process.env.APP_URL || 'https://adsec-tracker.onrender.com'}/admin">Review Request →</a>
            </div>` : ''}
          </div>

          <div class="footer">
            <p>You are receiving this because you are an admin on Leave Tracker.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const { data, error } = await resend.emails.send({
    from: 'Leave Tracker <onboarding@resend.dev>',
    to: adminEmails,
    subject,
    html
  });

  if (error) {
    throw new Error(error.message);
  }

  console.log(`Leave notification sent to: ${adminEmails.join(', ')} (id: ${data.id})`);
}

module.exports = { sendLeaveNotification };
