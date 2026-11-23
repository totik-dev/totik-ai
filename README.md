# Totik Murloc Bot (totik-ai)

Totik Channel Discord sunucusunda WoW Forever sorularını cevaplayan bot. Soru kanalında `!soru <soru>` yazılınca cevap verir; görsel eklenebilir veya bir mesaja yanıt olarak sorulabilir.

## Nasıl çalışır

- Cloudflare Worker + tek bir Durable Object (`DiscordGateway`). Bot Discord'a sürekli bağlı değildir; 10–30 saniyede bir soru kanalındaki yeni mesajları okur.
- Bot kimliği, guild/Totik bilgisi ve kaynak önerisi gibi sorular AI kullanılmadan sabit metinle cevaplanır.
- Soru bir rehber kartıyla eşleşirse (sınıf, zindan ya da meslek) bot kartın metninden 1–3 satırlık kısa bir cevap yazar, kartın görselini forumdaki konusundan alıp mesaja ekler ve sonuna "Bu konuda detaylı bilgi için … konusuna bakabilirsin" diye konunun bağlantısını koyar. Talent sorusunda sınıf ya da uzmanlık belli değilse önce onu sorar.
- 60. seviye kartları (23.11.2026'dan beri her uzmanlıkta dört kart): **Raid Talentleri** (60. seviye raid build'i), **Pre-BiS** (raid öncesi eşyalar ve enchantlar), **Raid Hazırlığı** (stat sırası, cap'ler, flask, iksir, yemek) ve **T0.5 Seti** (D1 setinin nereden düştüğü, T0.5 sürümleri, set bonusları ve takas zinciri). Soru 60. seviyeyi, raid'i ya da endgame'i soruyorsa ("rogue combat 60 talent", "raid build") Raid Talentleri kartı gider; "leveling", "1-60" ya da 60'tan küçük bir seviye geçiyorsa Leveling kartı. "pre bis", "bis", "60 olunca ne giymeli" Pre-BiS kartını; "stat önceliği", "flask", "iksir", "consumable" Raid Hazırlığı kartını; "t0.5", "dungeon set 2", "d1 seti", "set bonusu" T0.5 kartını getirir. Uzmanlık belli değilse bot hangi uzmanlığın kartını istediğini sorar; kısa cevap ("combat") aynı kart türüne gider. Bu kartlar kelime eşleşmesiyle seçilmez ve diğer kartların sıralamasını değiştirmez (`lateKind` ve `LATE_KINDS`, `src/cards.js`).
- Eski #leveling-talent kanalı 23.11.2026'da silindi; bot artık o kanala yönlendirmez. Kartsız talent sorularının sonuna sınıf rehberleri forumunu (`CLASS_FORUM_ID`, `src/index.js`) gösteren tek bir satır eklenir.
- "Arcane mi frost mu fire mi", "warrior hangi spec" gibi uzmanlık karşılaştırmalarında bot her uzmanlığın rolünü, güçlü ve zayıf yanlarını (`kartlar/sinif-bilgi.json`) kullanır ve en fazla iki uzmanlığın talent sırası kartını ekler. "Hangi sınıf tank olur", "hunter mı mage mı" gibi sınıf sorularını da aynı bilgiden cevaplar.
- Cevap yalnız soruya ait bölümden kurulur: uzmanlık belliyse Oynanış kartının diğer uzmanlık bölümleri, seviye belliyse talent sırası kartının o seviyedeki satırı öne alınır. Böylece başka uzmanlığın ya da mesleğin bilgisi cevaba karışmaz.
- Yazım hataları ("palladin", "deadmins", "gnomregan") ve kısaltmalar ("bm", "sfk", "strat ud") tanınır. "eng", "skin", "war", "dm" gibi günlük kelimeler tek başına kart getirmez.
- "Priest için hangi meslek", "kaç meslek alabilirim" gibi meslek seçimi sorularında bot, meslek kartlarındaki öneri satırlarını (`KİM`, `SINIF`, `KİMİN İŞİ`, `EŞ`, `İKİLİ`, `İKİNCİL`) kullanır; kartların o sınıf için önerdiği en fazla iki ana mesleğin genel kartını ekler ve iki konunun bağlantısını verir.
- "Alan vuran skili var mı", "aoe büyüleri" gibi sorularda bot, sınıfın yetenek ve talent kartlarında birden çok hedefe etki eden satırları ve Oynanış kartındaki `ÇOK HEDEF` notunu toplar.
- WoW Forever, WoW Classic değildir. Classic'ten farklı olan ve kartlarda yazmayan bilgiler (Stormwind Limanı ve gemiler, kütüphane kitapları, yeni sınıf ve ırk eşleşmelerinin eğitmenleri, yeni bölgeler ve zindanlar, Legacy, talent sıfırlama ve Dual Specialization, binek ve ücretleri, raid takvimi ve attunement, grup bulma, stat ve silah becerisi, ölüm ve Hearthstone, çantalar, fiyat ve paketler, Hunter petleri, eklentiler, Dalaran, yeni itibarlar, seviye sınırı, Darkmoon Faire, etkinlikler, Enhancement Shaman'ın silahı) `kartlar/forever-bilgi.json` dosyasındadır. Soru bu konulardan birine değiyorsa cevap bu notlardan kurulur; kart eklenmez, araştırma servisine sorulmaz. Kartın cevapladığı sorularda (zindan, meslek, talent) kart önceliklidir.
- Sınıfların hangi ırkla ve hangi tarafta oynandığı (`kartlar/sinif-bilgi.json`) her yapay zekâ çağrısına ve araştırma servisine giden her soruya eklenir. Araştırma servisi Classic bilir: cevabında "Alliance'ta Shaman yok", "Burning Crusade'de açıldı" gibi Forever'la çelişen bir cümle varsa cevap kullanılmaz, soru modele sorulur; modelin cevabındaki böyle cümleler de silinir.
- Ekipman sorularında ("20 level hunter ne giymeli", "priest hangi silah") kart eklenmez; cevap `kartlar/sinif-bilgi.json` içindeki zırh ve silah kuralından kurulur ve araştırma servisine sorulmaz.
- Bir cevabın ilk kaynağı şunlardır: rehber kartının metni, `kartlar/forever-bilgi.json` notları, `kartlar/sinif-bilgi.json` (sınıf, ırk, zırh ve silah kuralları) ve doğrulanmış ırk özellikleri. Bu kaynaklardan biri soruyu cevaplıyorsa modelin kendi hafızası kullanılmaz.
- Kart ve not birlikte kullanılır: soru bir sınıf kartına gidiyorsa ve bir Forever notuna da değiyorsa ("kurt hali ile binek arasında hız farkı") ikisi aynı çağrıda gönderilir. Karşılaştırma sorusunda her iki tarafın değeri de kaynakta yazmıyorsa cevap verilmez; not tek başına iki tarafı da tutmuyorsa soru nottan cevaplanmaz.
- Sayı kontrolü: cevaptaki yüzde, seviye, gold, süre gibi sayılar kaynak metinde ve soruda aranır (`unsupportedNumbers`). Kaynakta olmayan bir sayı varsa cevap gönderilmez; not sorusunda notun kendi satırı gönderilir.
- Kart ya da anahtar kelimesi tutan bir not yoksa bot "bilgim yok" demez, yedek yola geçer (`UNVERIFIED_ANSWERS=ai`, varsayılan):
  1. Görev, NPC, "nerede / nereden alınır" ve "nerede farm yapılır / nerede kasılır" soruları önce araştırma servisine (`WOW_AI_URL`) gider (farm yeri sorusunda sınıf kartı kullanılmaz: kartlar rotasyonu anlatır, yeri değil); servis Classic bilir, cevabı Forever kurallarıyla çelişiyorsa kullanılmaz.
  2. Model soruyu **bütün** Forever notlarıyla birlikte alır. Soru notlarda cevaplanıyorsa (anahtar kelime tutmamış olsa bile) cevap notlardan kurulur; cevaptaki sayılar notlarda aranır.
  3. Notlarda yoksa cevap WoW Classic bilgisinden gelir: önce araştırma servisi, o da cevap vermezse modelin emin olduğu Classic bilgisi. Cevabın altına kaynağını anlatan bir açıklama satırı eklenmez. Model, adı geçen eşya ya da görev hakkında emin değilse "haritada işaretlenir, NPC'lerle konuş" gibi her soruya uyan cümle yazmaz; cevap yok sayılır.
  4. Kimsenin cevabı yoksa bot "Bu konuda elimde doğrulanmış WoW Forever bilgisi yok…" der ve sorunun hakkını geri verir.
- İnternet araması (`TAVILY_API_KEY` gizli anahtarı tanımlıysa açılır; tanımlı değilse yukarıdaki sıra aynen çalışır): kart ya da anahtar kelimesi tutan not yoksa model bütün notları okur ve aynı çağrıda sorunun İngilizce arama sorgusunu yazar (eşya, görev ve NPC adları oyundaki İngilizce adıyla). Cevap notlardaysa arama yapılmaz. Değilse sorgudaki her ad için bir arama yapılır (çoğu soruda tek ad, karşılaştırma ya da çok eşyalı görev sorusunda en fazla 3 ad, yani en fazla 3 arama): yalnız Wowhead, warcraft.wiki.gg, Icy Veins, Warcraft Tavern ve Method sayfalarında. Wowhead'in WoW Forever sayfaları (`wowhead.com/forever/…`) önce gelir, Classic sayfaları sonra; başka sürümlerin (retail, Wrath, Cataclysm …) sayfaları kullanılmaz. Model cevabı yalnız bu sonuçlardan kurar; sonuçlarda olmayan bir sayı yazarsa cevap kullanılmaz. Cevabın altına açıklama satırı eklenmez. Arama cevap bulamazsa modelin genel bilgisi kullanılır. Bu yolda eski araştırma servisine sorulmaz.
  - Görselli soru: oyuncu ekran görüntüsü eklediyse görseldeki görev adı ve eşya, NPC, yer adları okunur (en fazla iki deneme). "Bunları nereden bulacağım" gibi yalnız görseli gösteren sorularda bu adlar aranır. Görsel okunamazsa ve soru tek başına anlaşılmıyorsa bot tahmin yürütmez: "Görseli okuyamadım. Görevin ya da eşyanın adını yazarak tekrar sorar mısın? Bu deneme hakkından düşmedi." yazar.
  - Log kanalındaki "Cevapsız soru" ve "Genel bilgiden cevaplandı" satırlarında aramanın durumu da yazar: "Not: İnternet araması kapalı (arama anahtarı eklenmemiş)", "Not: İnternet araması sonuç bulamadı", "Not: İnternet araması yapıldı, sonuçlar soruyu cevaplamadı" ya da "Not: Görsel okunamadı".
  - Arama çalışmazsa (kullanım sınırı dolmuş, anahtar geçersiz) oyuncunun cevabı etkilenmez; log kanalındaki satıra "Not: İnternet araması çalışmadı (kullanım sınırı dolmuş)" eklenir ve hata `GET /status` çıktısında `last_search_error` olarak görünür.
  - Arama hafızası: bir aramanın bulduğu sonuçlar, sorgudaki eşya, görev ya da NPC adının altında botun kendi deposunda saklanır (ör. `search:satchel of potions`). Aynı ad tekrar sorulduğunda önce saklanan sonuçlara bakılır; cevap oradaysa arama yapılmaz. Saklanan sonuçlar cevaplamıyorsa bir kere yeni arama yapılır ve bulunanlar hafızaya eklenir (ad başına en yeni 8 sonuç). Sonuçlar 30 gün saklanır; hiçbir şey bulamayan arama 3 gün boyunca tekrarlanmaz; hata veren arama hatırlanmaz. Oyuncuyla ilgili hiçbir şey saklanmaz. Kaç aramanın yapıldığı ve kaç sorunun hafızadan cevaplandığı `GET /status` çıktısında `search_stats` olarak görünür. `SEARCH_MEMORY=off` hafızayı kapatır.
  - `SEARCH_DEPTH=advanced` aramayı daha ayrıntılı yapar (Tavily'de arama başına 2 kredi; varsayılan `basic` 1 kredi).
- `UNVERIFIED_ANSWERS` ayarının diğer değerleri: `research` (yalnız görev, NPC ve yer sorularında araştırma servisi; gerisine "doğrulanmış bilgim yok"), `none` (kimseye sorulmaz). `all`, `ai` ile aynıdır.
- Kart ve nottan cevaplanamayan son 60 soru `GET /status` çıktısındaki `uncovered_questions` listesinde durur; her satırda oyuncunun ne aldığı yazar (`how`: `cevapsız`, `araştırma`, `internet araması`, `genel bilgi`). Bota eklenecek notların listesi budur.
- Emoji ile geri bildirim: bot her oyun cevabının altına 👍 ve 👎 koyar ("bilgim yok" cevabına, bekleme uyarısına ve geri sorulan sorulara koymaz). Bot beş dakikada bir soru kanalının son 100 mesajını bir kere okur; bir oyuncunun 👎 koyduğu cevabı, sorusu, cevap metni, işaretleyenlerin adı ve cevabın bağlantısıyla birlikte log kanalına "Yanlış bulunan cevap" başlığıyla bir kez yazar. Yapay zekâ çağrısı yapılmaz: cevap başına iki küçük Discord isteği ve beş dakikada bir okuma. Cevaplar bunun için bir hafta saklanır. Botun soru kanalında "Tepki Ekle" izni olmalıdır; izin yoksa oyuncunun cevabı etkilenmez, hata `GET /status` çıktısında `last_feedback_error` olarak görünür (oyuncunun elle koyduğu 👎 yine yakalanır). `FEEDBACK_REACTIONS=off` sistemi kapatır.
- Log kanalı: bot üç durumda gizli log kanalına (`LOG_CHANNEL_ID`, `src/index.js`) tek satırlık bir mesaj yazar: cevap veremediği soru, modelin genel bilgisinden cevapladığı soru (verdiği cevapla birlikte) ve teknik hata. Mesajda soru, soran kişinin adı ve sorunun bağlantısı olur; kimse etiketlenmez. Yapay zekâ çağrısı yapılmaz. Botun bu kanalı görme ve mesaj gönderme izni olmalıdır; izin yoksa oyuncunun cevabı etkilenmez, hata `GET /status` çıktısında `last_log_error` olarak görünür. `LOG_CHANNEL_ID` ortam değişkeni başka bir kanal numarası ya da `off` (kapalı) olabilir.
- "Priest rehberi nerede", "deadmines rehberi var mı" gibi sorularda bot rehberi anlatmaz; konunun adını kalın yazıp forumdaki bağlantısını verir (sınıf rehberinde talent, Pre-BiS ve T0.5 kartlarının da o konuda olduğunu söyler). Bu cevap yapay zekâ kullanmaz ve bekleme süresinden düşmez. Discord, yüklemediği forum konularını "bilinmeyen" diye gösterebildiği için kart cevaplarının sonundaki bağlantının yanına da konunun adı yazılır.
- Tier list ve meta soruları (`tier`, `meta`, "A-S arası") zindan ya da sınıf kartına gitmez; `tier-list` notundan cevaplanır. Para kazanma soruları ("para nasıl kazanırım", "gold farm") kart almaz; soruda geçen meslekler oyuncunun durumu sayılır ve model seviyeye ve mesleklere göre 2-4 yol söyler. "Para kazanmak için hangi meslek" yine meslek önerisidir.
- Mesajın sonunda soru işareti olmadan gelen ve soru sormayan parça ("… kazanabilirim? 40 seviyeyim mesleklerim herbalism ve alchemy") ayrı soru sayılmaz, önceki sorunun bağlamı olur.
- Hiçbir kural uymazsa bot soruyla en çok ortak kelimesi olan kartı dener; bu durumda kart yalnız AI adımı "kart bu soruyu cevaplıyor" derse kullanılır.
- Bekleme süresi: YouTube Katıl / Twitch Sub / Kick abonesi / premium rolü 1 dakika, diğer üyeler 30 dakika. Cevap verilemezse hak geri verilir. Kick abonesi rolü `1566519827965812966` numaralı roldür (`src/index.js`, `KICK_SUB_ROLE_ID`); `KICK_SUB_ROLE_IDS` ile ek rol numarası verilebilir.
- Cooldown, mesaj durumu ve forum konularının listesi Durable Object depolamasında tutulur; ayrı veritabanı yoktur.

## Dosyalar

| Dosya | Ne |
|---|---|
| `src/index.js` | Bot: Discord, bekleme süresi, cevap akışı. |
| `src/cards.js` | Kart seçici: bir soruya hangi kartların uyduğuna karar verir. Ağ kullanmaz. |
| `src/cards-data.js` | 301 kartın tam metni (112'si 60. seviye sınıf kartı). Elle düzenlenmez; `npm run cards` üretir. |
| `kartlar/kartlar.json` | Kart listesi: her kartın konusu, forumdaki dosya adı, forum ve konu başlığı, anahtar kelimeler. |
| `kartlar/metin/<id>.md` | Her kartın içindeki bilginin tamamı, düz metin olarak. Botun bilgi tabanı budur. |
| `kartlar/sinif-bilgi.json` | Kartlarda yazmayan doğrulanmış sınıf bilgisi: uzmanlıkların rolü, artıları ve eksileri, sınıfların ırkları, ırka göre öneriler, sınıfın giydiği zırh ve kullandığı silah türleri (Classic kuralı; Shaman'da Forever farkı: çift silah yok, iki elli axe ve mace talent gerektirmez). |
| `kartlar/forever-bilgi.json` | Forever'ın Classic'ten farklı olan, kartlarda yazmayan bilgileri. Her not: `baslik`, `anahtar` (soruda aranan kelime kökleri; `+` ile ayrılanların hepsi geçmeli), `satirlar` (cevabın dayandığı cümleler), isteğe bağlı `ozet` (her yapay zekâ çağrısına eklenen tek cümle). Kaynak: Blizzard duyuruları ve Forever rehberleri (11–13.11.2026). Düzeltme ya da ekleme sonrası `npm run cards`. |
| `scripts/build-cards.mjs` | `kartlar/` klasöründen `src/cards-data.js` dosyasını üretir. |
| `scripts/raid-kartlari.mjs` | 60. seviye sınıf kartlarının (Raid Talentleri, Pre-BiS, Raid Hazırlığı, T0.5 Seti) metnini ve `kartlar.json` satırlarını kartların çizildiği veriden yazar. |
| `tests/` | Otomatik testler. Ağ kullanmaz; Discord ve AI servisleri sahte cevaplarla taklit edilir. |
| `tests/questions.test.mjs`, `tests/questions-reviewed.mjs` | Soru bataryası: 1200'den fazla gerçek tarzda soru ve her birinin alması gereken kart. |

## Değişiklik yaparken

```sh
npm install
npm test        # soru eşleştirme ve bot davranışı testleri
npm run check   # Worker'ı deploy etmeden derler
```

GitHub'a gönderilen her değişiklikte bu iki adım otomatik çalışır (Actions → Test). Kırmızı görünürse değişiklik bir şeyi bozmuş demektir.

Bir kart değişirse `kartlar/metin/` altındaki metnini düzelt, yeni kart eklenirse `kartlar/kartlar.json`'a da ekle, sonra `npm run cards` çalıştır. Test, `src/cards-data.js` güncel değilse ve 301 kartın birinin metni eksikse kırmızı olur.

60. seviye sınıf kartlarının metni, kartların çizildiği veriden üretilir: `node scripts/raid-kartlari.mjs "<Totik Edit Studio>/calisma/discord"` (veri-raid, wow-forever-hazirlik/kart ve gonderim-yeni klasörleri), sonra `npm run cards`. Bir pre-BiS listesi ya da raid build'i değişirse bu iki komut yeniden çalıştırılır.

Kartların görselleri repoda durmaz. Bot, sunucudaki forum kanallarını (Class, Zindan, Meslek rehberleri) günde bir kez tarar, konuları başlığından tanır ve kartı konudaki ekin dosya adından bulur. Her soruda yalnız o soruya uyan 1–2 kart forumdan alınır. Bu yüzden forumdaki konu başlıkları ve dosya adları `kartlar.json` ile aynı kalmalı; botun bu üç forumu görme ve mesaj geçmişini okuma izni olmalı.

Bot bir soruya "doğrulanmış bilgim yok" diyorsa bilgi `kartlar/forever-bilgi.json` dosyasına not olarak eklenir (yalnız kaynakların birbirini tuttuğu bilgi), `npm run cards` çalıştırılır ve `tests/questions-reviewed.mjs` listesine `["soru", "note=not-id"]` satırı eklenir.

Bot bir soruya yanlış kart verirse soruyu ve doğru kartı `tests/questions-reviewed.mjs` listesine ekle (`["soru", "=kart-id"]`), sonra `src/cards.js` içindeki kuralı düzelt. Batarya, bir düzeltmenin başka soruları bozup bozmadığını gösterir. Bu testler Discord'a ya da AI servisine bağlanmaz, kota harcamaz.

## Ayarlar (Cloudflare değişkenleri)

Zorunlu gizli değerler: `DISCORD_BOT_TOKEN`, `GEMINI_API_KEY`, `ADMIN_API_KEY` (en az 32 karakter).

İsteğe bağlı: `TAVILY_API_KEY` (internet araması; gizli anahtar olarak eklenir), `SEARCH_DEPTH`, `SEARCH_MEMORY` (`off` = arama hafızası kapalı), `FEEDBACK_REACTIONS` (`off` = emoji ile geri bildirim kapalı), `UNVERIFIED_ANSWERS` (`research`, `none` ya da `all`), `DISCORD_GUILD_ID`, `WOW_AI_URL`, `WOW_AI_METHOD` (`POST` ya da boş = GET), `WOW_AI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_VISION_MODEL`, `TOTIK_PROFILE_JSON`, `YOUTUBE_MEMBER_ROLE_IDS`, `TWITCH_SUB_ROLE_IDS`, `KICK_SUB_ROLE_IDS`, `PREMIUM_ROLE_IDS`, `COMMUNITY_EDITOR_IDS`, `SPECIAL_GUIDE_CHANNEL_ID`.

`TOTIK_PROFILE_JSON` alanları: `about`, `guildName`, `realm`, `ruleset`, `faction`, `guildRequirements`, `applicationInstructions`, `guildContacts`, `streamSchedule`.

Kanal, sunucu ve sahip ID'leri `src/index.js` içinde sabittir (`QUESTION_CHANNEL_ID`, `GUILD_ID`, `OWNER_ID` vb.).

## Çalıştırma

1. `npm run deploy`
2. Botu başlat: `POST https://<worker-adresi>/start` ve başlık `Authorization: Bearer <ADMIN_API_KEY>`
3. Herkese açık durum sayfası: `GET /health` (botun çalışıp çalışmadığını ve rehber forumlarında kaç konuyu bulduğunu gösterir: `kart_konulari: 61/61`; internet aramasının durumunu da gösterir: `internet_aramasi: acik`, `kapali` (anahtar eklenmemiş) ya da `hata` (son arama reddedildi)).
4. Durum: `GET /status`, kart kontrolü: `GET /card-check` (aynı başlıkla; botun forumlarda bulamadığı konuları ve kartları listeler). Durdurmak için `POST /stop`.
