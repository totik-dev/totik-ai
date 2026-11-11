# Totik Murloc Bot (totik-ai)

Totik Channel Discord sunucusunda WoW Forever sorularını cevaplayan bot. Soru kanalında `!soru <soru>` yazılınca cevap verir; görsel eklenebilir veya bir mesaja yanıt olarak sorulabilir.

## Nasıl çalışır

- Cloudflare Worker + tek bir Durable Object (`DiscordGateway`). Bot Discord'a sürekli bağlı değildir; 10–30 saniyede bir soru kanalındaki yeni mesajları okur.
- Bot kimliği, guild/Totik bilgisi ve kaynak önerisi gibi sorular AI kullanılmadan sabit metinle cevaplanır.
- Soru bir rehber kartıyla eşleşirse (sınıf, zindan ya da meslek) bot kartın metninden 1–3 satırlık kısa bir cevap yazar, kartın görselini forumdaki konusundan alıp mesaja ekler ve sonuna "Bu konuda detaylı bilgi için … konusuna bakabilirsin" diye konunun bağlantısını koyar. Talent sorusunda sınıf ya da uzmanlık belli değilse önce onu sorar.
- Kart soruyu karşılamıyorsa ya da eşleşme yoksa WoW AI servisi (`WOW_AI_URL`), o da cevap vermezse Gemini kullanılır.
- Bekleme süresi: YouTube Katıl / Twitch Sub / premium rolü 1 dakika, diğer üyeler 15 dakika. Cevap verilemezse hak geri verilir.
- Cooldown, mesaj durumu ve forum konularının listesi Durable Object depolamasında tutulur; ayrı veritabanı yoktur.

## Dosyalar

| Dosya | Ne |
|---|---|
| `src/index.js` | Bot: Discord, bekleme süresi, cevap akışı. |
| `src/cards.js` | Kart seçici: bir soruya hangi kartların uyduğuna karar verir. Ağ kullanmaz. |
| `src/cards-data.js` | 189 kartın tam metni. Elle düzenlenmez; `npm run cards` üretir. |
| `kartlar/kartlar.json` | Kart listesi: her kartın konusu, forumdaki dosya adı, forum ve konu başlığı, anahtar kelimeler. |
| `kartlar/metin/<id>.md` | Her kartın içindeki bilginin tamamı, düz metin olarak. Botun bilgi tabanı budur. |
| `scripts/build-cards.mjs` | `kartlar/` klasöründen `src/cards-data.js` dosyasını üretir. |
| `tests/` | Otomatik testler. Ağ kullanmaz; Discord ve AI servisleri sahte cevaplarla taklit edilir. |

## Değişiklik yaparken

```sh
npm install
npm test        # soru eşleştirme ve bot davranışı testleri
npm run check   # Worker'ı deploy etmeden derler
```

GitHub'a gönderilen her değişiklikte bu iki adım otomatik çalışır (Actions → Test). Kırmızı görünürse değişiklik bir şeyi bozmuş demektir.

Bir kart değişirse `kartlar/metin/` altındaki metnini düzelt, yeni kart eklenirse `kartlar/kartlar.json`'a da ekle, sonra `npm run cards` çalıştır. Test, `src/cards-data.js` güncel değilse ve 189 kartın birinin metni eksikse kırmızı olur.

Kartların görselleri repoda durmaz. Bot, sunucudaki forum kanallarını (Class, Zindan, Meslek rehberleri) günde bir kez tarar, konuları başlığından tanır ve kartı konudaki ekin dosya adından bulur. Her soruda yalnız o soruya uyan 1–2 kart forumdan alınır. Bu yüzden forumdaki konu başlıkları ve dosya adları `kartlar.json` ile aynı kalmalı; botun bu üç forumu görme ve mesaj geçmişini okuma izni olmalı.

Yeni bir soru kalıbının doğru karta gitmesini istiyorsan `tests/routing.test.mjs` içindeki `CASES` listesine ekle.

## Ayarlar (Cloudflare değişkenleri)

Zorunlu gizli değerler: `DISCORD_BOT_TOKEN`, `GEMINI_API_KEY`, `ADMIN_API_KEY` (en az 32 karakter).

İsteğe bağlı: `DISCORD_GUILD_ID`, `WOW_AI_URL`, `WOW_AI_METHOD` (`POST` ya da boş = GET), `WOW_AI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_VISION_MODEL`, `TOTIK_PROFILE_JSON`, `YOUTUBE_MEMBER_ROLE_IDS`, `TWITCH_SUB_ROLE_IDS`, `PREMIUM_ROLE_IDS`, `COMMUNITY_EDITOR_IDS`, `SPECIAL_GUIDE_CHANNEL_ID`.

`TOTIK_PROFILE_JSON` alanları: `about`, `guildName`, `realm`, `ruleset`, `faction`, `guildRequirements`, `applicationInstructions`, `guildContacts`, `streamSchedule`.

Kanal, sunucu ve sahip ID'leri `src/index.js` içinde sabittir (`QUESTION_CHANNEL_ID`, `GUILD_ID`, `OWNER_ID` vb.).

## Çalıştırma

1. `npm run deploy`
2. Botu başlat: `POST https://<worker-adresi>/start` ve başlık `Authorization: Bearer <ADMIN_API_KEY>`
3. Herkese açık durum sayfası: `GET /health` (botun çalışıp çalışmadığını ve rehber forumlarında kaç konuyu bulduğunu gösterir: `kart_konulari: 61/61`).
4. Durum: `GET /status`, kart kontrolü: `GET /card-check` (aynı başlıkla; botun forumlarda bulamadığı konuları ve kartları listeler). Durdurmak için `POST /stop`.
