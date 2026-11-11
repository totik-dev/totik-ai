# Totik Murloc Bot (totik-ai)

Totik Channel Discord sunucusunda WoW Forever sorularını cevaplayan bot. Soru kanalında `!soru <soru>` yazılınca cevap verir; görsel eklenebilir veya bir mesaja yanıt olarak sorulabilir.

## Nasıl çalışır

- Cloudflare Worker + tek bir Durable Object (`DiscordGateway`). Bot Discord'a sürekli bağlı değildir; 10–30 saniyede bir soru kanalındaki yeni mesajları okur.
- Bot kimliği, guild/Totik bilgisi ve kaynak önerisi gibi sorular AI kullanılmadan sabit metinle cevaplanır.
- Soru bir rehber kartıyla eşleşirse (sınıf, zindan ya da meslek) bot kartın metninden 1–3 satırlık kısa bir cevap yazar, kartın görselini forumdaki konusundan alıp mesaja ekler ve sonuna "Bu konuda detaylı bilgi için … konusuna bakabilirsin" diye konunun bağlantısını koyar. Talent sorusunda sınıf ya da uzmanlık belli değilse önce onu sorar.
- "Arcane mi frost mu fire mi", "warrior hangi spec" gibi uzmanlık karşılaştırmalarında bot her uzmanlığın rolünü, güçlü ve zayıf yanlarını (`kartlar/sinif-bilgi.json`) kullanır ve en fazla iki uzmanlığın talent sırası kartını ekler. "Hangi sınıf tank olur", "hunter mı mage mı" gibi sınıf sorularını da aynı bilgiden cevaplar.
- Cevap yalnız soruya ait bölümden kurulur: uzmanlık belliyse Oynanış kartının diğer uzmanlık bölümleri, seviye belliyse talent sırası kartının o seviyedeki satırı öne alınır. Böylece başka uzmanlığın ya da mesleğin bilgisi cevaba karışmaz.
- Yazım hataları ("palladin", "deadmins", "gnomregan") ve kısaltmalar ("bm", "sfk", "strat ud") tanınır. "eng", "skin", "war", "dm" gibi günlük kelimeler tek başına kart getirmez.
- "Priest için hangi meslek", "kaç meslek alabilirim" gibi meslek seçimi sorularında bot, meslek kartlarındaki öneri satırlarını (`KİM`, `SINIF`, `KİMİN İŞİ`, `EŞ`, `İKİLİ`, `İKİNCİL`) kullanır; kartların o sınıf için önerdiği en fazla iki ana mesleğin genel kartını ekler ve iki konunun bağlantısını verir.
- "Alan vuran skili var mı", "aoe büyüleri" gibi sorularda bot, sınıfın yetenek ve talent kartlarında birden çok hedefe etki eden satırları ve Oynanış kartındaki `ÇOK HEDEF` notunu toplar.
- WoW Forever, WoW Classic değildir. Classic'ten farklı olan ve kartlarda yazmayan bilgiler (Stormwind Limanı ve gemiler, kütüphane kitapları, yeni sınıf ve ırk eşleşmelerinin eğitmenleri, yeni bölgeler, Legacy, Dual Specialization, binek, raid takvimi, Enhancement Shaman'ın silahı) `kartlar/forever-bilgi.json` dosyasındadır. Soru bu konulardan birine değiyorsa cevap bu notlardan kurulur; kart eklenmez, araştırma servisine sorulmaz. Kartın cevapladığı sorularda (zindan, meslek, talent) kart önceliklidir.
- Sınıfların hangi ırkla ve hangi tarafta oynandığı (`kartlar/sinif-bilgi.json`) her yapay zekâ çağrısına ve araştırma servisine giden her soruya eklenir. Araştırma servisi Classic bilir: cevabında "Alliance'ta Shaman yok", "Burning Crusade'de açıldı" gibi Forever'la çelişen bir cümle varsa cevap kullanılmaz, soru modele sorulur; modelin cevabındaki böyle cümleler de silinir.
- Ekipman sorularında ("20 level hunter ne giymeli", "priest hangi silah") kart eklenmez; cevap `kartlar/sinif-bilgi.json` içindeki zırh ve silah kuralından kurulur ve araştırma servisine sorulmaz.
- Görev ve "nereden alınır" soruları araştırma servisine gider. Servis "bu bilgi verilerde yer almıyor" gibi bir cümleyle dönerse soru bir kez de Gemini'ye sorulur; böyle dolgu cümleleri cevaptan çıkarılır.
- Hiçbir kural uymazsa bot soruyla en çok ortak kelimesi olan kartı dener; bu durumda kart yalnız AI adımı "kart bu soruyu cevaplıyor" derse kullanılır.
- Kart soruyu karşılamıyorsa ya da eşleşme yoksa WoW AI servisi (`WOW_AI_URL`), o da cevap vermezse Gemini kullanılır.
- Bekleme süresi: YouTube Katıl / Twitch Sub / Kick abonesi / premium rolü 1 dakika, diğer üyeler 15 dakika. Cevap verilemezse hak geri verilir. Kick abonesi rolü `1566519827965812966` numaralı roldür (`src/index.js`, `KICK_SUB_ROLE_ID`); `KICK_SUB_ROLE_IDS` ile ek rol numarası verilebilir.
- Cooldown, mesaj durumu ve forum konularının listesi Durable Object depolamasında tutulur; ayrı veritabanı yoktur.

## Dosyalar

| Dosya | Ne |
|---|---|
| `src/index.js` | Bot: Discord, bekleme süresi, cevap akışı. |
| `src/cards.js` | Kart seçici: bir soruya hangi kartların uyduğuna karar verir. Ağ kullanmaz. |
| `src/cards-data.js` | 189 kartın tam metni. Elle düzenlenmez; `npm run cards` üretir. |
| `kartlar/kartlar.json` | Kart listesi: her kartın konusu, forumdaki dosya adı, forum ve konu başlığı, anahtar kelimeler. |
| `kartlar/metin/<id>.md` | Her kartın içindeki bilginin tamamı, düz metin olarak. Botun bilgi tabanı budur. |
| `kartlar/sinif-bilgi.json` | Kartlarda yazmayan doğrulanmış sınıf bilgisi: uzmanlıkların rolü, artıları ve eksileri, sınıfların ırkları, ırka göre öneriler, sınıfın giydiği zırh ve kullandığı silah türleri (Classic kuralı; Shaman'da Forever farkı: çift silah yok, iki elli axe ve mace talent gerektirmez). |
| `kartlar/forever-bilgi.json` | Forever'ın Classic'ten farklı olan, kartlarda yazmayan bilgileri. Her not: `baslik`, `anahtar` (soruda aranan kelime kökleri; `+` ile ayrılanların hepsi geçmeli), `satirlar` (cevabın dayandığı cümleler), isteğe bağlı `ozet` (her yapay zekâ çağrısına eklenen tek cümle). Kaynak: Blizzard duyuruları ve Forever rehberleri (11.11.2026). Düzeltme ya da ekleme sonrası `npm run cards`. |
| `scripts/build-cards.mjs` | `kartlar/` klasöründen `src/cards-data.js` dosyasını üretir. |
| `tests/` | Otomatik testler. Ağ kullanmaz; Discord ve AI servisleri sahte cevaplarla taklit edilir. |
| `tests/questions.test.mjs`, `tests/questions-reviewed.mjs` | Soru bataryası: 1200'den fazla gerçek tarzda soru ve her birinin alması gereken kart. |

## Değişiklik yaparken

```sh
npm install
npm test        # soru eşleştirme ve bot davranışı testleri
npm run check   # Worker'ı deploy etmeden derler
```

GitHub'a gönderilen her değişiklikte bu iki adım otomatik çalışır (Actions → Test). Kırmızı görünürse değişiklik bir şeyi bozmuş demektir.

Bir kart değişirse `kartlar/metin/` altındaki metnini düzelt, yeni kart eklenirse `kartlar/kartlar.json`'a da ekle, sonra `npm run cards` çalıştır. Test, `src/cards-data.js` güncel değilse ve 189 kartın birinin metni eksikse kırmızı olur.

Kartların görselleri repoda durmaz. Bot, sunucudaki forum kanallarını (Class, Zindan, Meslek rehberleri) günde bir kez tarar, konuları başlığından tanır ve kartı konudaki ekin dosya adından bulur. Her soruda yalnız o soruya uyan 1–2 kart forumdan alınır. Bu yüzden forumdaki konu başlıkları ve dosya adları `kartlar.json` ile aynı kalmalı; botun bu üç forumu görme ve mesaj geçmişini okuma izni olmalı.

Bot bir soruya yanlış kart verirse soruyu ve doğru kartı `tests/questions-reviewed.mjs` listesine ekle (`["soru", "=kart-id"]`), sonra `src/cards.js` içindeki kuralı düzelt. Batarya, bir düzeltmenin başka soruları bozup bozmadığını gösterir. Bu testler Discord'a ya da AI servisine bağlanmaz, kota harcamaz.

## Ayarlar (Cloudflare değişkenleri)

Zorunlu gizli değerler: `DISCORD_BOT_TOKEN`, `GEMINI_API_KEY`, `ADMIN_API_KEY` (en az 32 karakter).

İsteğe bağlı: `DISCORD_GUILD_ID`, `WOW_AI_URL`, `WOW_AI_METHOD` (`POST` ya da boş = GET), `WOW_AI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_VISION_MODEL`, `TOTIK_PROFILE_JSON`, `YOUTUBE_MEMBER_ROLE_IDS`, `TWITCH_SUB_ROLE_IDS`, `KICK_SUB_ROLE_IDS`, `PREMIUM_ROLE_IDS`, `COMMUNITY_EDITOR_IDS`, `SPECIAL_GUIDE_CHANNEL_ID`.

`TOTIK_PROFILE_JSON` alanları: `about`, `guildName`, `realm`, `ruleset`, `faction`, `guildRequirements`, `applicationInstructions`, `guildContacts`, `streamSchedule`.

Kanal, sunucu ve sahip ID'leri `src/index.js` içinde sabittir (`QUESTION_CHANNEL_ID`, `GUILD_ID`, `OWNER_ID` vb.).

## Çalıştırma

1. `npm run deploy`
2. Botu başlat: `POST https://<worker-adresi>/start` ve başlık `Authorization: Bearer <ADMIN_API_KEY>`
3. Herkese açık durum sayfası: `GET /health` (botun çalışıp çalışmadığını ve rehber forumlarında kaç konuyu bulduğunu gösterir: `kart_konulari: 61/61`).
4. Durum: `GET /status`, kart kontrolü: `GET /card-check` (aynı başlıkla; botun forumlarda bulamadığı konuları ve kartları listeler). Durdurmak için `POST /stop`.
