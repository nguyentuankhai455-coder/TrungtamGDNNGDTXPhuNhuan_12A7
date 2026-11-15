12A7 PORTAL — REBUILD V2

Giao diện:
- Bộ nhận diện navy / champagne, responsive desktop và mobile.
- Menu sửa lỗi active state: chỉ đánh dấu đúng trang/anchor hiện tại.
- Góc học tập đã tách thành hoctap.html riêng.
- Trang chủ chỉ dẫn đến Góc học tập, không nhúng lại toàn bộ khu vực.

Google Sheets:
- Tin tức: Spreadsheet ID 10WZAkfTsUhEsTRADxZ3JX869kLV_Sen45r4BeSrxDZY, sheet mặc định.
- Tài liệu học tập: GID 782348969.
- Báo bài: TSV GID 1447199433.
- Giáo viên: GID 590362463.
- Góc Xanh: GID 940791294.
- Hoạt động phong trào: TSV GID 2104947705.
- Thư viện ảnh: GID 208030591.
- Thời khóa biểu: ảnh tkb.png trong thư mục gốc (đặt lại ảnh thời khóa biểu ở đây).

Tương tác bài viết:
- Nút cảm xúc: Thích, Yêu thích, Haha, Wow, Cảm động.
- Bình luận công khai theo từng bài.
- Dữ liệu sử dụng Firebase Realtime Database hiện có:
  https://a7-website-3bd33-default-rtdb.asia-southeast1.firebasedatabase.app/
- Node lưu: articleInteractions/{articleKey}/reactions và /comments.
- articleKey là khóa được mã hóa từ loại bài + ID bài, ví dụ news_90 hoặc phongtrao_90.
- Trình duyệt tạo client ID ngẫu nhiên trong localStorage để tránh đếm trùng cảm xúc từ cùng một trình duyệt.
- Nếu Rules không cho đọc/ghi, giao diện sẽ báo lỗi quyền truy cập. Không mở quyền ghi toàn database chỉ để chạy bình luận.
- Nên hoàn thiện Firebase Authentication và quy tắc kiểm tra dữ liệu trước khi triển khai công khai.

Đăng nhập/đăng ký:
- UI đã có, chưa xác thực Firebase. Không gửi hoặc lưu mật khẩu.

Các trang:
index.html, hoctap.html, baobai.html, giaovien.html, profile-gv.html,
gocxanh.html, thanhvien.html, thuvien.html, credits.html, baiviet.html.
Tài nguyên dùng chung: assets/site.css và assets/app.js.

Triển khai:
1. Sao lưu repository.
2. Giải nén ZIP và upload toàn bộ nội dung trong thư mục này lên thư mục gốc repository.
3. Giữ tkb.png và logo/ảnh tài nguyên của website nếu đang dùng.
4. Commit/push để Render deploy.


IMPORTANT — FIREBASE INTERACTIONS PRESERVED (PATCH)
The article interaction UI now reads/writes the PREVIOUS Firebase Realtime Database schema:
articleInteractions/news_{id}/
articleInteractions/gocxanh_{id}/
articleInteractions/baobai_{row}/
  views/{uid}: {count,lastAt}
  reactions/{uid}: {type,updatedAt}
  comments/{commentId}: {uid,name,content,createdAt}

No alternate a_<base64> keys are used. No existing articleInteractions nodes are deleted, renamed, reset or migrated.
This is a presentation-layer update with the old data schema preserved.


HOMEPAGE BANNER
- index.html hiển thị banner.jpg ngay dưới menu.
- File banner.jpg đã được đóng gói ở thư mục gốc, không cần tự tìm hoặc tải thêm.
