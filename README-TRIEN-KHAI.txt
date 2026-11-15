# 12A7 Member System — triển khai thông báo & nhật ký hoạt động

## Phần đã tích hợp
- Chuông thông báo + số thông báo chưa đọc trên header khi thành viên đăng nhập.
- `thongbao.html`: thông báo cá nhân, đánh dấu đã đọc, lịch sử hoạt động của chính tài khoản.
- `quanly-hoatdong.html`: trang GVCN/Admin tra cứu nhật ký, lọc theo ngày/tài khoản/loại hoạt động, xem IP đầy đủ (chỉ IP đã được đồng ý ghi) và xuất CSV.
- Gửi thông báo chung đến các tài khoản email đã đăng ký Firebase Authentication.
- Nhật ký sự kiện: đăng nhập, đăng xuất, đăng ký, đăng bình luận, xóa bình luận, thả/gỡ cảm xúc.
- IP do máy chủ nhận (`req.ip` qua Render proxy), không nhận IP do trình duyệt tự khai.
- IP chỉ được ghi khi thành viên chọn “Đồng ý ghi nhận IP”. Nếu từ chối, vẫn lưu UID, loại hoạt động và thời gian nhưng không lưu IP.
- Khi thu hồi đồng ý, IP cũ của UID đó được xóa khỏi `activityLogs`.
- Dữ liệu nhật ký tự dọn sau 90 ngày (đặt `IP_RETENTION_DAYS` trong Render).

## Giữ nguyên dữ liệu cũ
- Không đổi Firebase Auth project/config.
- Không tạo lại hay thay đổi các nhánh phân quyền hiện có.
- Không sửa nhánh `articleInteractions/{postKey}` và cấu trúc `views`, `reactions`, `comments`.
- Không lưu nội dung bình luận hoặc mật khẩu vào nhật ký.
- Dữ liệu thông báo mới nằm ở `notifications/{uid}`; nhật ký mới ở `activityLogs`; lựa chọn IP ở `privacyConsents/{uid}`.

## Cấu trúc dự án
- `public/`: các trang HTML và tài nguyên website.
- `server.js`: API xác thực ID token, ghi IP từ phía server, đọc nhật ký, gửi thông báo, dọn log.
- `package.json`: Node dependencies.
- `render.yaml`: cấu hình Render Web Service.
- `firebase_rules_additions_only.json`: phần rules cần ghép vào rules hiện có.

## Triển khai trên Render — cần tạo Web Service Node
Website hiện đang được phục vụ theo kiểu static HTML. Ghi IP an toàn cần một API máy chủ; bộ này chạy website và API chung trong một Node Web Service.

1. Sao lưu GitHub repository và giữ nguyên Static Site đang chạy cho đến khi Web Service mới được kiểm thử.
2. Đưa nội dung thư mục này vào một thư mục riêng trong repository (ví dụ `12A7_member_system/`) hoặc repository triển khai riêng.
3. Tạo Render **New → Web Service** trỏ đến repository đó. Nếu dùng thư mục con, đặt Root Directory là `12A7_member_system`.
4. Build Command: `npm install`. Start Command: `npm start`. Runtime Node 20+.
5. Mở Render → Environment và thêm:
   - `FIREBASE_DATABASE_URL` = `https://a7-website-3bd33-default-rtdb.asia-southeast1.firebasedatabase.app`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = toàn bộ nội dung JSON Service Account của Firebase project `a7-website-3bd33`
   - `IP_RETENTION_DAYS` = `90`
6. Service Account JSON là bí mật máy chủ. Lấy trong Google Cloud Console / IAM Service Accounts của đúng project. Không tải file JSON lên GitHub, không đặt trong `public/`, không gửi qua chat. Chỉ dán vào Environment Variable của Render.
7. Firebase Authentication → Settings → Authorized domains: thêm hostname `onrender.com` mới được cấp cho Web Service.
8. Kiểm tra `https://<web-service>.onrender.com/api/health`. Phải thấy `"firebaseConfigured": true`.
9. Mở `/thongbao.html`, đăng nhập, đọc thông báo quyền riêng tư và chọn đồng ý hoặc không đồng ý lưu IP.
10. Thử đăng bình luận/thả cảm xúc, kiểm tra lịch sử tài khoản; dùng tài khoản đã có quyền Admin/GVCN để mở `/quanly-hoatdong.html`, lọc và xuất CSV.
11. Chỉ chuyển người dùng sang URL Web Service mới sau khi thử xong. Giữ Static Site cũ làm phương án quay lui.

## Firebase Realtime Database Rules
Không thay toàn bộ Rules hiện tại bằng file additions. Mở `firebase_rules_additions_only.json` và ghép các nhánh `notifications`, `announcements`, `activityLogs`, `privacyConsents` vào object `rules` đang dùng.
- Không xóa nhánh `admins` hoặc `articleInteractions`.
- `activityLogs` không được cấp `.read`/`.write` cho client; chỉ server Admin SDK truy cập.
- `notifications/{uid}` chỉ UID đó đọc được. Client chỉ được cập nhật `readAt`, không tự tạo thông báo.
- `announcements` cho người dùng đã đăng nhập đọc; server Admin SDK ghi.

## Quyền quản trị
API kiểm tra quyền dựa trên các dấu hiệu hiện hữu, ưu tiên `admins/{uid} === true`; cũng nhận custom claims `role=admin/gvcn` hoặc nhánh `roles`, `userRoles`, `staff`, `gvcn`, `gvcns` nếu project đã có. Không tự tạo hoặc thay đổi role.
Nếu GVCN/Admin hiện tại không được nhận diện, cần đối chiếu đường dẫn phân quyền thực tế trước khi chỉnh; không mở quyền quản trị cho mọi người.

## Lưu ý riêng tư
- Nhật ký ghi UID, email đã xác minh (nếu có), tên hiển thị Firebase, sự kiện, mã bài viết/comment, cảm xúc, thời gian, user-agent và IP nếu có đồng ý.
- Không lưu mật khẩu, nội dung bình luận hoặc nội dung tin nhắn.
- Thành viên có thể không đồng ý hoặc thu hồi đồng ý IP; phần lịch sử hoạt động phi-IP vẫn hoạt động.
- IP là dữ liệu có thể nhận diện/định vị tương đối và có thể là mạng dùng chung/VPN; không kết luận danh tính chỉ từ IP.
- Thời hạn lưu được cấu hình 90 ngày. Render Free có thể sleep, nên cleanup chạy khi service hoạt động; nếu cần đúng hạn tuyệt đối nên dùng Cron Job riêng.
- Trước khi dùng với học sinh, nhà trường/GVCN cần xem xét thông báo quyền riêng tư và quy trình đồng ý phù hợp, nhất là khi có người chưa thành niên.

## API endpoints
- `GET /api/health`
- `POST /api/activity`
- `GET /api/activity/me`
- `GET /api/activity` (staff only)
- `GET /api/staff/me`
- `GET /api/privacy/status`
- `POST /api/privacy/consent`
- `POST /api/notifications/broadcast` (staff only)
