
(function(){
  const SHEET_ID = '10WZAkfTsUhEsTRADxZ3JX869kLV_Sen45r4BeSrxDZY';
  const TSV_BAOBAI = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQzikJgQA99tZH8THj1ecKZBDbxH4GMM3snKPtovgaGdr_vVNv72F63qPl_epUs0rVSedCqx5elaJvB/pub?gid=1447199433&single=true&output=tsv';
  const TSV_PHONGTRAO = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQzikJgQA99tZH8THj1ecKZBDbxH4GMM3snKPtovgaGdr_vVNv72F63qPl_epUs0rVSedCqx5elaJvB/pub?gid=2104947705&single=true&output=tsv';
  const GIDS = {docs:'782348969', teachers:'590362463', green:'940791294', gallery:'208030591'};
  const $ = (selector, root=document) => root.querySelector(selector);

  function esc(value){
    return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function parseCell(cell){
    if(!cell || cell.v === null || cell.v === undefined) return '';
    if(cell.f !== undefined && cell.f !== null && String(cell.f).trim()) return String(cell.f).trim();
    const val = String(cell.v).trim();
    if(val.startsWith('Date(')){
      const m=val.match(/\d+/g);
      if(m && m.length>=3) return `${String(+m[2]).padStart(2,'0')}/${String(+m[1]+1).padStart(2,'0')}/${m[0]}`;
    }
    return val;
  }
  function linkify(text){
    const safe=esc(text);
    return safe.replace(/(https?:\/\/[^\s<]+)/g, url=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  }
  function parseTSV(text){
    text=String(text||'').replace(/^\uFEFF/,'');
    const rows=[]; let row=[], cell='', quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='"' && quoted && text[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"') quoted=!quoted;
      else if(ch==='\t'&&!quoted){row.push(cell);cell='';}
      else if((ch==='\n'||ch==='\r')&&!quoted){
        if(ch==='\r'&&text[i+1]==='\n')i++;
        row.push(cell); if(row.some(v=>String(v).trim()))rows.push(row);row=[];cell='';
      } else cell+=ch;
    }
    row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);
    return rows.map(r=>r.map(v=>String(v??'').trim()));
  }
  async function fetchTSV(url){
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const text=await response.text();
    if(!text.trim()||/<html[\s>]/i.test(text.slice(0,500)))throw new Error('Không nhận được TSV công khai');
    return parseTSV(text);
  }
  function loadGViz(gid, callback){
    const cb='a7Gviz_'+Math.random().toString(36).slice(2);
    const script=document.createElement('script');
    let done=false;
    const timer=setTimeout(()=>finishError(new Error('Google Sheets quá thời gian phản hồi')),18000);
    function cleanup(){clearTimeout(timer);script.remove();try{delete window[cb];}catch(e){window[cb]=undefined;}}
    function finishError(error){if(done)return;done=true;cleanup();callback(null,error);}
    window[cb]=json=>{if(done)return;done=true;cleanup();if(!json||json.status==='error'||!json.table){callback(null,new Error('Google Sheets trả về dữ liệu không hợp lệ'));return;}callback(json,null);};
    script.onerror=()=>finishError(new Error('Không tải được Google Sheets'));
    const gidQuery=gid ? `gid=${encodeURIComponent(gid)}&` : '';
    script.src=`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${gidQuery}tqx=responseHandler:${cb}`;
    document.body.appendChild(script);
  }
  function showToast(message){
    let toast=$('#a7-toast');
    if(!toast){toast=document.createElement('div');toast.id='a7-toast';toast.className='toast';document.body.appendChild(toast);}
    toast.textContent=message;toast.classList.add('show');
    clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),3000);
  }

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD_bg0nSmeOma70PVZSKlW9OxWDqXuzrA0",
    authDomain: "a7-website-3bd33.firebaseapp.com",
    databaseURL: "https://a7-website-3bd33-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "a7-website-3bd33",
    storageBucket: "a7-website-3bd33.firebasestorage.app",
    messagingSenderId: "1022960527978",
    appId: "1:1022960527978:web:c5f8286381710491053813",
    measurementId: "G-QR9J1DNYV6"
  };

  let firebaseAuth = null;
  let currentAuthUser = null;

  function firebaseErrorMessage(error){
    const code = error && error.code ? error.code : '';
    const messages = {
      'auth/email-already-in-use':'Email này đã được đăng ký. Hãy đăng nhập thay vì tạo tài khoản mới.',
      'auth/invalid-email':'Địa chỉ email không hợp lệ.',
      'auth/weak-password':'Mật khẩu quá yếu. Hãy sử dụng ít nhất 6 ký tự.',
      'auth/user-not-found':'Không tìm thấy tài khoản với email này.',
      'auth/wrong-password':'Mật khẩu không chính xác.',
      'auth/invalid-credential':'Email hoặc mật khẩu không chính xác.',
      'auth/too-many-requests':'Bạn đã thử quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.',
      'auth/network-request-failed':'Không thể kết nối Firebase. Hãy kiểm tra mạng Internet.',
      'auth/operation-not-allowed':'Phương thức Email/Password chưa được bật trong Firebase Authentication.',
      'auth/unauthorized-domain':'Tên miền website chưa được thêm vào Authorized domains trong Firebase.'
    };
    return messages[code] || (error && error.message) || 'Có lỗi xảy ra. Vui lòng thử lại.';
  }

  function showAuthStatus(message, kind){
    const status = $('#a7-auth-status');
    if(!status) return;
    status.textContent = message;
    status.className = 'auth-status show' + (kind === 'success' ? ' auth-success' : '');
  }

  function renderAccountHeader(user){
    const actions = $('.header-actions');
    if(!actions) return;

    if(user && !user.isAnonymous){
      const display = user.displayName || user.email || 'Thành viên 12A7';
      const shortDisplay = display.length > 23 ? display.slice(0,20) + '…' : display;
      actions.innerHTML = `
        <span class="account-chip" title="${esc(display)}">
          <span class="account-avatar">${esc((display.trim()[0] || 'A').toUpperCase())}</span>
          <span class="account-label">${esc(shortDisplay)}</span>
        </span>
        <button class="auth-btn" type="button" data-auth-logout>Đăng xuất</button>`;
    }else{
      actions.innerHTML = `
        <button class="auth-btn" type="button" data-auth-open="login">Đăng nhập</button>
        <button class="auth-btn primary" type="button" data-auth-open="register">Đăng ký <span aria-hidden="true">↗</span></button>`;
    }
  }

  function initializeFirebaseAuth(){
    if(!window.firebase || !firebase.auth){
      console.error('Firebase Auth SDK chưa được tải.');
      return;
    }
    try{
      if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      firebaseAuth = firebase.auth();
      firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .catch(error => console.error('Không thiết lập được lưu phiên đăng nhập:', error));
      firebaseAuth.onAuthStateChanged(user => {
        currentAuthUser = user || null;
        renderAccountHeader(currentAuthUser);
        window.A7Auth = {
          auth: firebaseAuth,
          currentUser: currentAuthUser,
          signOut: () => firebaseAuth.signOut()
        };
        window.dispatchEvent(new CustomEvent('a7-auth-state-changed', {detail:{user:currentAuthUser}}));
      });
    }catch(error){
      console.error('Không thể khởi tạo Firebase Authentication:', error);
    }
  }

  function injectAuth(){
    if($('#a7-auth-modal')) return;
    const markup = `
      <div class="modal-backdrop" id="a7-auth-modal" aria-hidden="true">
        <section class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="a7-auth-title">
          <div class="auth-dialog-head">
            <button class="auth-close" type="button" aria-label="Đóng" data-auth-close>×</button>
            <div class="eyebrow">12A7 MEMBER AREA</div>
            <h2 id="a7-auth-title">Chào mừng trở lại</h2>
            <p>Đăng nhập để đồng hành cùng cộng đồng 12A7.</p>
          </div>
          <div class="auth-dialog-body">
            <div class="auth-switch">
              <button type="button" class="active" data-auth-tab="login">Đăng nhập</button>
              <button type="button" data-auth-tab="register">Đăng ký</button>
            </div>
            <form class="auth-form" id="a7-auth-form">
              <div id="a7-name-field" hidden>
                <label for="a7-auth-name">Họ và tên</label>
                <input id="a7-auth-name" name="name" autocomplete="name" maxlength="60" placeholder="Nhập họ và tên">
              </div>
              <div>
                <label for="a7-auth-email">Email</label>
                <input id="a7-auth-email" name="email" type="email" autocomplete="email" required placeholder="example@gmail.com">
              </div>
              <div>
                <label for="a7-auth-password">Mật khẩu</label>
                <input id="a7-auth-password" name="password" type="password" minlength="6" autocomplete="current-password" required placeholder="Tối thiểu 6 ký tự">
              </div>
              <div id="a7-confirm-field" hidden>
                <label for="a7-auth-confirm">Xác nhận mật khẩu</label>
                <input id="a7-auth-confirm" name="confirm" type="password" minlength="6" autocomplete="new-password" placeholder="Nhập lại mật khẩu">
              </div>
              <button class="auth-submit" id="a7-auth-submit" type="submit">Đăng nhập</button>
            </form>
            <div class="auth-status" id="a7-auth-status" role="status" aria-live="polite"></div>
            <p class="auth-note">Tài khoản được quản lý bởi Firebase Authentication. Không chia sẻ mật khẩu với người khác.</p>
          </div>
        </section>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', markup);

    let mode = 'login';
    const modal = $('#a7-auth-modal');

    function setMode(next){
      mode = next;
      $('#a7-auth-title').textContent = mode === 'login' ? 'Chào mừng trở lại' : 'Tạo tài khoản 12A7';
      $('#a7-auth-submit').textContent = mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
      $('#a7-name-field').hidden = mode !== 'register';
      $('#a7-confirm-field').hidden = mode !== 'register';
      $('#a7-auth-name').required = mode === 'register';
      $('#a7-auth-confirm').required = mode === 'register';
      $('#a7-auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      modal.querySelectorAll('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === mode));
      $('#a7-auth-status').className = 'auth-status';
      $('#a7-auth-status').textContent = '';
    }

    function open(modeWanted){
      modal.classList.add('open');
      modal.setAttribute('aria-hidden','false');
      setMode(modeWanted || 'login');
      setTimeout(() => $('#a7-auth-email').focus(), 80);
    }

    function close(){
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden','true');
      $('#a7-auth-form').reset();
      $('#a7-auth-status').className = 'auth-status';
      $('#a7-auth-status').textContent = '';
    }

    document.addEventListener('click', async event => {
      const openButton = event.target.closest('[data-auth-open]');
      if(openButton){ open(openButton.dataset.authOpen); return; }

      if(event.target.closest('[data-auth-close]') || event.target === modal){ close(); return; }

      const tab = event.target.closest('[data-auth-tab]');
      if(tab){ setMode(tab.dataset.authTab); return; }

      const logoutButton = event.target.closest('[data-auth-logout]');
      if(logoutButton){
        logoutButton.disabled = true;
        try{
          if(!firebaseAuth) throw new Error('Firebase Authentication chưa sẵn sàng.');
          await firebaseAuth.signOut();
          showToast('Bạn đã đăng xuất.');
        }catch(error){
          showToast(firebaseErrorMessage(error));
        }finally{
          logoutButton.disabled = false;
        }
      }
    });

    document.addEventListener('keydown', event => { if(event.key === 'Escape') close(); });

    $('#a7-auth-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if(!form.reportValidity()) return;

      if(!firebaseAuth){
        showAuthStatus('Firebase Authentication chưa khởi tạo. Hãy kiểm tra SDK và cấu hình Firebase.', 'error');
        return;
      }

      const email = form.elements.email.value.trim();
      const password = form.elements.password.value;
      const name = (form.elements.name.value || '').trim();
      const confirm = form.elements.confirm.value;

      if(mode === 'register' && password !== confirm){
        showAuthStatus('Mật khẩu xác nhận chưa khớp.', 'error');
        return;
      }
      if(mode === 'register' && !name){
        showAuthStatus('Vui lòng nhập họ và tên.', 'error');
        return;
      }

      const submit = $('#a7-auth-submit');
      submit.disabled = true;
      submit.textContent = mode === 'login' ? 'Đang đăng nhập…' : 'Đang tạo tài khoản…';

      try{
        await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        if(mode === 'register'){
          const credential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
          if(name) await credential.user.updateProfile({displayName:name});
          showAuthStatus('Tạo tài khoản thành công. Bạn đã đăng nhập vào Cổng thông tin 12A7.', 'success');
          showToast('Chào mừng bạn đến với 12A7!');
        }else{
          await firebaseAuth.signInWithEmailAndPassword(email, password);
          showAuthStatus('Đăng nhập thành công.', 'success');
          showToast('Đăng nhập thành công!');
        }
        setTimeout(close, 650);
      }catch(error){
        console.error('Firebase Authentication error:', error);
        showAuthStatus(firebaseErrorMessage(error), 'error');
      }finally{
        submit.disabled = false;
        submit.textContent = mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
      }
    });
  }

  function setActiveNav(){
    const path=location.pathname.split('/').pop()||'index.html';
    const hash=location.hash||'';
    document.querySelectorAll('.nav-link').forEach(link=>{
      const raw=(link.getAttribute('href')||'').trim();
      const [href,linkHash]=raw.split('#');
      const samePage=(href||'index.html')===path;
      const active=samePage && (linkHash ? hash==='#'+linkHash : !hash);
      link.classList.toggle('active',active);
    });
  }
  function mount(){
    injectAuth();setActiveNav();initializeFirebaseAuth();
    window.A7={SHEET_ID,TSV_BAOBAI,TSV_PHONGTRAO,GIDS,$,esc,parseCell,linkify,parseTSV,fetchTSV,loadGViz,showToast,FIREBASE_CONFIG};
  }
  // app.js được nạp ở cuối body, nên DOM của trang đã sẵn sàng cho các script trang chạy tiếp theo.
  mount();
})();
