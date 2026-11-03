# Okur — Okuma Takibi (PWA)

iOS "Liquid Glass" görünümlü, derleme gerektirmeyen (vanilla ES modülleri) kitap ve okuma alışkanlığı takip uygulaması. Safari → Paylaş → **Ana Ekrana Ekle** ile tam ekran uygulama gibi çalışır.

## Kurulum

1. **Firebase projesi** oluşturun → *Web uygulaması ekle* → verilen yapılandırmayı `js/firebase-config.js` içindeki `firebaseConfig` nesnesine yapıştırın.
2. **Authentication → Sign-in method**: *E-posta/Şifre* ve *Google* sağlayıcılarını açın. *Settings → Authorized domains* listesine Cloudflare Pages alan adınızı (`xxx.pages.dev` ve varsa özel alan adınız) ekleyin.
3. **Firestore Database** oluşturun ve bu depodaki `firestore.rules` içeriğini *Rules* sekmesinde yayınlayın.
4. (Önemle önerilir) Google Cloud konsolunda aynı proje için **Books API**'yi etkinleştirin ve *Credentials → Browser key (auto created by Firebase)* anahtarının API kısıtlamalarına **Books API**'yi ekleyin. Uygulama bu anahtarı otomatik kullanır (ayrı bir anahtar isterseniz `js/api-books.js` → `GOOGLE_BOOKS_API_KEY`). Anahtarsız Google istekleri ortak günlük kotaya takılır (429); o durumda yalnızca Open Library kullanılır — Türkçe baskılar (ör. "Söğütler") çoğunlukla bulunmaz ve kapaklar daha yavaş gelir.

> **Önemli:** Sosyal özellikler (`usernames`, `publicProfiles`, `friendships`) için `firestore.rules` dosyasının **güncel halini** Firebase konsolunda yayınlamanız gerekir; aksi halde kayıt sırasında kullanıcı adı kontrolü "izin reddedildi" hatası verir.

**Sosyal:** Kayıt olurken @kullanıcı adı seçilir (sonradan Ayarlar'dan değiştirilebilir). Giriş, e-posta ya da @kullanıcı adıyla yapılabilir. Sosyal sekmesinden kullanıcı adıyla arkadaş eklenir; arkadaşlar birbirinin serisini, okuduğu kitapları, son bitirdiklerini ve haftalık sayfa sıralamasını görür. Not: @ad ile giriş için kullanıcı adı → e-posta eşlemesi `usernames` belgesinde tutulur; bu belgeler tek tek okunabilir ama listelenemez.

Uygulama hesap olmadan da tam olarak kullanılabilir: veriler o cihazda saklanır. Ayarlar → **Giriş yap** ile hesaba bağlanıldığında cihazdaki tüm kitaplar, kayıtlar, alıntılar ve ayarlar hesaba aktarılır ve bundan sonra her şey Firestore üzerinden gerçek zamanlı senkronize olur. `firebaseConfig` doldurulmadıysa giriş seçeneği gizlenir, uygulama yerel modda çalışır.

Kapak görselleri hız için [wsrv.nl](https://wsrv.nl) görüntü CDN'i üzerinden küçültülüp webp olarak yüklenir; başarısız olursa doğrudan kaynağa ve ISBN tabanlı Open Library kapağına düşer.

## Yayınlama (GitHub → Cloudflare Pages)

- Depoyu GitHub'a gönderin; Cloudflare Pages'te *Connect to Git* ile bağlayın.
- **Framework preset:** None · **Build command:** boş · **Build output directory:** `/`
- `_redirects` SPA yönlendirmesini, `_headers` güvenlik ve önbellek başlıklarını sağlar.
- Yeni sürüm yayınladığınızda `sw.js` içindeki `VERSION` değerini artırın.

## Yerel çalıştırma

Kamera (barkod) ve Service Worker için `localhost` veya HTTPS gerekir:

```bash
python -m http.server 8080
```

## Yapı

```
index.html            Uygulama kabuğu, PWA meta etiketleri
manifest.json         PWA manifestosu
sw.js                 Çevrimdışı önbellek
_redirects, _headers  Cloudflare Pages yapılandırması
firestore.rules       Firestore güvenlik kuralları
css/                  variables · liquid-glass · layout · animations
js/app.js             Router, durum, görünümler, sheet akışları, zamanlayıcı
js/firebase-config.js Firebase Auth + Firestore (onSnapshot) veri katmanı
js/api-books.js       Google Books + Open Library arama / ISBN
js/stats-engine.js    Seri, ısı haritası, grafikler, excludeFromStats filtresi
js/ui-components.js   Sheet'ler, Dinamik Ada, halkalar, swipe, paylaşım kartı
icons/                SVG + PNG uygulama ikonları
```
