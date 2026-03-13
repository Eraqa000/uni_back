import sys
import json
import os

# Порог: рекомендовать только для предметов ниже этого балла
RECOMMEND_THRESHOLD = 80

# IT-ключевые слова для фильтрации курсов (только IT-релевантные)
IT_KEYWORDS = [
    "programming", "python", "java", "javascript", "typescript", "c++", "c#", "golang", "rust", "swift", "kotlin",
    "web", "html", "css", "frontend", "backend", "fullstack", "full-stack", "react", "angular", "vue", "node",
    "database", "sql", "nosql", "mongodb", "postgresql", "mysql", "redis", "firebase",
    "algorithm", "data structure", "computer science", "software", "engineering", "development",
    "network", "networking", "cisco", "tcp", "ip", "protocol", "cybersecurity", "security", "cryptography",
    "operating system", "linux", "unix", "cloud", "aws", "azure", "gcp", "devops", "docker", "kubernetes",
    "machine learning", "deep learning", "neural", "ai ", "artificial intelligence", "data science",
    "mobile", "android", "ios", "app development", "api", "rest", "graphql",
    "git", "version control", "agile", "scrum", "testing", "debugging",
]

# Перевод русских/казахских тем → английские ключевые слова для поиска
# Ключи поддерживают стемминг: "математик" совпадёт с "математика", "математический", "математики"
TRANSLATIONS = {
    # --- Математика ---
    "математик": ["mathematics", "math", "calculus", "algebra", "linear algebra", "discrete math"],
    "матем": ["mathematics", "math", "calculus"],
    "анализ": ["calculus", "mathematical analysis", "analysis", "precalculus"],
    "алгебр": ["algebra", "linear algebra", "mathematics"],
    "геометр": ["geometry", "linear algebra", "mathematics"],
    "статистик": ["statistics", "probability", "data analysis"],
    "вероятност": ["probability", "statistics"],
    "дискретн": ["discrete mathematics", "combinatorics", "graph theory"],
    "численн": ["numerical methods", "scientific computing", "computational"],

    # --- Программирование ---
    "программирован": ["programming", "python", "coding", "software", "development"],
    "програм": ["programming", "coding", "software"],
    "код": ["coding", "programming"],
    "bағдарла": ["programming", "coding"],  # казахский

    # --- Базы данных ---
    "баз": ["database", "sql", "mongodb", "postgresql", "nosql"],
    "данных": ["database", "sql", "data", "nosql"],
    "деректер": ["database", "sql", "data"],  # казахский

    # --- Алгоритмы ---
    "алгоритм": ["algorithm", "data structure", "computational", "complexity"],
    "структур": ["data structure", "algorithm", "computer science"],

    # --- Сети ---
    "сет": ["networking", "network", "cisco", "tcp", "protocol"],
    "желілер": ["network", "networking"],  # казахский
    "коммуникац": ["networking", "protocol", "communication"],
    "протокол": ["protocol", "networking", "tcp"],

    # --- Веб ---
    "веб": ["web", "html", "css", "javascript", "frontend", "react", "node"],
    "интернет": ["web", "internet", "networking", "html"],
    "фронтенд": ["frontend", "html", "css", "javascript", "react"],
    "бэкенд": ["backend", "node", "api", "server"],

    # --- Machine Learning ---
    "машинн": ["machine learning", "deep learning", "neural", "ai"],
    "обучен": ["machine learning", "deep learning", "training"],
    "нейрон": ["neural network", "deep learning", "ai"],
    "интеллект": ["artificial intelligence", "ai", "machine learning"],

    # --- ОС и системы ---
    "операцион": ["operating system", "linux", "unix", "kernel"],
    "систем": ["operating system", "linux", "system administration"],
    "linux": ["linux", "unix", "operating system"],

    # --- Безопасность ---
    "безопасност": ["security", "cybersecurity", "cryptography", "ethical hacking"],
    "криптограф": ["cryptography", "security", "encryption"],
    "хакинг": ["ethical hacking", "penetration testing", "cybersecurity"],
    "қауіпсіздік": ["security", "cybersecurity"],  # казахский

    # --- Разработка / Архитектура ---
    "разработк": ["software development", "engineering", "programming"],
    "архитектур": ["software architecture", "design pattern", "microservices"],
    "объектн": ["object oriented", "oop", "design pattern"],
    "паттерн": ["design pattern", "software architecture", "oop"],

    # --- Мобильная разработка ---
    "мобильн": ["mobile", "android", "ios", "react native", "flutter"],
    "андроид": ["android", "mobile", "kotlin", "java"],

    # --- DevOps / Облако ---
    "облачн": ["cloud", "aws", "azure", "gcp", "devops"],
    "devops": ["devops", "docker", "kubernetes", "ci/cd"],
    "контейнер": ["docker", "kubernetes", "containerization"],

    # --- Тестирование ---
    "тестирован": ["testing", "qa", "quality assurance", "selenium"],
    "качеств": ["quality assurance", "testing", "qa"],

    # --- Общее IT ---
    "компьютерн": ["computer science", "computing", "computer vision"],
    "информатик": ["computer science", "information technology", "it"],
    "цифров": ["digital", "information technology", "computing"],
    "технологи": ["technology", "it", "software"],
}


def log(msg):
    print(f"[agent] {msg}", file=sys.stderr, flush=True)


def load_courses():
    path = "course_agent/courses.json"
    if not os.path.exists(path):
        log(f"Файл не найден: {path}")
        return []
    with open(path, "r", encoding="utf-8") as f:
        courses = json.load(f)
    log(f"Загружено {len(courses)} курсов")
    return courses


def is_it_course(course):
    """Проверяет, является ли курс IT-релевантным."""
    text = (course["name"] + " " + course.get("description", "")).lower()
    return any(kw in text for kw in IT_KEYWORDS)


def get_subject_keywords(subject_name):
    """
    Возвращает список английских ключевых слов для поиска.
    Поддерживает стемминг: ключ "математик" совпадёт с "математика",
    "математический", "математики" и т.д.
    """
    name_lower = subject_name.lower()
    eng_keywords = []

    # Ищем совпадения по стеммингу (ключ содержится в слове или слово в ключе)
    for ru_stem, eng_list in TRANSLATIONS.items():
        words = name_lower.split()
        # Совпадение если: стем входит в слово ИЛИ слово входит в стем
        matched = any(
            ru_stem in word or word in ru_stem
            for word in words
            if len(word) > 2
        )
        if matched:
            eng_keywords.extend(eng_list)
            log(f"  Стем '{ru_stem}' → {eng_list}")

    # Если ничего не нашли — пробуем посимвольно весь текст
    if not eng_keywords:
        for ru_stem, eng_list in TRANSLATIONS.items():
            if ru_stem in name_lower:
                eng_keywords.extend(eng_list)

    return list(set(eng_keywords)) if eng_keywords else []


def score_course(course, keywords):
    """Считает релевантность курса по ключевым словам. Возвращает 0..100."""
    text = (course["name"] + " " + course.get("description", "")).lower()
    hits = sum(1 for kw in keywords if kw in text)
    # Нормализуем: чем больше совпадений из возможных, тем выше скор
    if not keywords:
        return 0
    raw_score = hits / len(keywords)
    return round(min(raw_score * 150, 99), 1)  # cap at 99%


def filter_and_rank_courses(all_courses, subject_name, max_candidates=20):
    """
    1. Фильтрует только IT-курсы
    2. Ранжирует по релевантности к предмету
    3. Возвращает топ max_candidates
    """
    keywords = get_subject_keywords(subject_name)
    log(f"Ключевые слова для '{subject_name}': {keywords}")

    it_courses = [c for c in all_courses if is_it_course(c)]
    log(f"IT-курсов после фильтрации: {len(it_courses)}")

    scored = []
    for course in it_courses:
        s = score_course(course, keywords)
        if s > 0:
            scored.append((s, course))

    scored.sort(key=lambda x: x[0], reverse=True)
    result = scored[:max_candidates]
    log(f"Найдено релевантных кандидатов: {len(result)}")

    # Если совсем ничего не нашли — возвращаем пустой список
    # (не хотим рекомендовать случайные курсы, не связанные с предметом)
    if not result:
        log("Тематических совпадений нет — пропускаем предмет")

    return result  # список (score, course)


def integration_type_by_mark(avg_mark):
    if avg_mark < 50:
        return "обязательное изучение"
    elif avg_mark < 70:
        return "дополнение"
    else:
        return "углублённое изучение"


def difficulty_fits_mark(difficulty: str, avg_mark: int) -> bool:
    """Проверяет соответствие сложности курса уровню студента."""
    if difficulty == "unknown":
        return True
    if avg_mark < 50:
        return difficulty in ("beginner", "unknown")
    if avg_mark < 70:
        return difficulty in ("beginner", "intermediate", "unknown")
    return True  # сильный студент — любой уровень


def combined_score(match_score: float, rating: float, difficulty: str, avg_mark: int) -> float:
    """Итоговый скор = match_score * вес_рейтинга * бонус_за_сложность."""
    rating_bonus = 1.0 + (rating / 5.0) * 0.3  
    difficulty_bonus = 1.1 if difficulty_fits_mark(difficulty, avg_mark) else 0.7
    return round(match_score * rating_bonus * difficulty_bonus, 1)


def recommend_without_llm(scored_candidates, subject_name, avg_mark):
    """Fallback без Gemini — ранжируем по комбинированному скору."""
    integration = integration_type_by_mark(avg_mark)

    # Пересчитываем скор с учётом рейтинга и сложности
    reranked = []
    for match_score, c in scored_candidates:
        difficulty = c.get("difficulty", "unknown")
        rating = c.get("rating", 0)
        final = combined_score(match_score, rating, difficulty, avg_mark)
        reranked.append((final, match_score, c))

    reranked.sort(key=lambda x: x[0], reverse=True)
    top3 = reranked[:3]

    return [
        {
            "title": c["name"],
            "url": c["url"],
            "description": c.get("description", "")[:200],
            "rating": c.get("rating", 0),
            "difficulty": c.get("difficulty", "unknown"),
            "language": c.get("language", ["en"]),
            "match_score": round(min(final_score, 99), 1),
            "integration_type": integration,
            "reason": f"Курс совпадает с темой '{subject_name}' и рекомендован для уровня: {integration}"
        }
        for final_score, match_score, c in top3
    ]


def recommend(student_data):
    api_key = os.environ.get("GEMINI_API_KEY")

    gemini_available = False
    model = None

    if api_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-3-flash-preview")
            gemini_available = True
            log("Gemini инициализирован")
        except Exception as e:
            log(f"Gemini недоступен: {e}")
    else:
        log("GEMINI_API_KEY не найден, работаю в fallback режиме")

    all_courses = load_courses()
    if not all_courses:
        print(json.dumps([]))
        return

    subjects = student_data.get("subjects", [])

    # Сортируем предметы: сначала с низкими баллами (где нужна помощь больше всего)
    subjects_sorted = sorted(subjects, key=lambda s: s.get("avg_mark", 0))

    # Рекомендуем только для предметов ниже порога
    weak_subjects = [s for s in subjects_sorted if s.get("avg_mark", 0) < RECOMMEND_THRESHOLD]

    if not weak_subjects:
        log("Все предметы выше порога — берём 3 самых слабых")
        weak_subjects = subjects_sorted[:3]

    log(f"Предметов для рекомендаций: {len(weak_subjects)} (порог < {RECOMMEND_THRESHOLD})")

    results = []

    for subject in weak_subjects:
        subject_name = subject["name"]
        avg_mark = subject.get("avg_mark", 0)
        log(f"Обрабатываю: {subject_name} (балл: {avg_mark})")

        scored_candidates = filter_and_rank_courses(all_courses, subject_name)

        if gemini_available and model:
            level = (
                "слабый — нужны базовые курсы" if avg_mark < 50
                else "средний — подойдут стандартные курсы" if avg_mark < 70
                else "хороший — можно брать продвинутые курсы"
            )

            course_list = "\n".join([
                f"{i+1}. {c['name']} | Совпадение: {score}% | Рейтинг: {c.get('rating',0)} | Уровень: {c.get('difficulty','unknown')} | {c.get('description','')[:80]}"
                for i, (score, c) in enumerate(scored_candidates)
            ])

            prompt = f"""Ты советник IT-университета. Подбери курсы студенту.
Студент: {student_data["student_name"]}
Предмет: {subject_name}
Балл студента: {avg_mark}/100 (уровень: {level})

Доступные IT-курсы (отсортированы по релевантности):
{course_list}

Выбери топ-3 курса. Правила:
- Если балл < 50: выбирай beginner курсы
- Если балл 50-70: intermediate курсы
- Если балл > 70: advanced или intermediate курсы
- Предпочитай курсы с высоким рейтингом
Верни ТОЛЬКО JSON без markdown:
[{{"index":1,"match_score":85,"integration_type":"дополнение","reason":"причина на русском"}}]"""

            try:
                log("Запрос в Gemini...")
                response = model.generate_content(prompt)
                text = response.text.replace("```json", "").replace("```", "").strip()
                log(f"Ответ Gemini: {text[:100]}")
                ratings = json.loads(text)

                top_courses = []
                for r in ratings:
                    idx = r["index"] - 1
                    if 0 <= idx < len(scored_candidates):
                        score, c = scored_candidates[idx]
                        top_courses.append({
                            "title": c["name"],
                            "url": c["url"],
                            "description": c.get("description", "")[:200],
                            "rating": c.get("rating", 0),
                            "difficulty": c.get("difficulty", "unknown"),
                            "language": c.get("language", ["en"]),
                            "match_score": r.get("match_score", score),
                            "integration_type": r.get("integration_type", integration_type_by_mark(avg_mark)),
                            "reason": r.get("reason", "")
                        })

                results.append({
                    "subject_id": subject["id"],
                    "subject_name": subject_name,
                    "avg_mark": avg_mark,
                    "courses": top_courses
                })
                log(f"Готово (Gemini): {len(top_courses)} курсов")

            except Exception as e:
                log(f"Gemini ошибка ({e.__class__.__name__}), fallback...")
                top_courses = recommend_without_llm(scored_candidates, subject_name, avg_mark)
                results.append({
                    "subject_id": subject["id"],
                    "subject_name": subject_name,
                    "avg_mark": avg_mark,
                    "courses": top_courses
                })
                log(f"Готово (fallback): {len(top_courses)} курсов")
        else:
            top_courses = recommend_without_llm(scored_candidates, subject_name, avg_mark)
            results.append({
                "subject_id": subject["id"],
                "subject_name": subject_name,
                "avg_mark": avg_mark,
                "courses": top_courses
            })
            log(f"Готово (fallback): {len(top_courses)} курсов")

    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    raw = sys.stdin.read()
    log(f"Получено {len(raw)} символов")
    input_data = json.loads(raw)
    recommend(input_data)
