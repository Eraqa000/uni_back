# course_agent/scraper.py
"""
  - IT-фильтр при сборе (только релевантные курсы)
  - Длинные описания (до 1000 символов)
  - Рейтинг из вторичного API (courses.v2)
  - Уровень сложности (beginner/intermediate/advanced)
  - Чекпоинт: продолжает с места остановки
  - Собирает до 5000 IT-курсов
"""

import requests
import json
import time
import os

MAX_COURSES = 5000
BATCH_SIZE = 100
SLEEP_BETWEEN = 0.4
OUTPUT_PATH = "course_agent/courses.json"
CHECKPOINT_PATH = "course_agent/.scraper_checkpoint.json"

# IT-ключевые слова для фильтрации при сборе
IT_FILTER_KEYWORDS = [
    "python", "java", "javascript", "typescript", "c++", "c#", "golang", "rust", "swift", "kotlin",
    "programming", "coding", "software", "developer", "development",
    "web", "html", "css", "react", "angular", "vue", "node", "frontend", "backend", "fullstack",
    "database", "sql", "nosql", "mongodb", "postgresql", "mysql", "redis",
    "algorithm", "data structure", "computer science",
    "network", "networking", "cybersecurity", "security", "cryptography", "ethical hacking",
    "operating system", "linux", "unix", "cloud", "aws", "azure", "gcp", "devops",
    "docker", "kubernetes", "ci/cd", "microservices",
    "machine learning", "deep learning", "neural network", "artificial intelligence",
    "data science", "data analysis", "data engineering", "big data",
    "mobile", "android", "ios", "flutter", "react native",
    "api", "rest", "graphql", "git", "agile", "testing", "qa",
    "computer vision", "nlp", "natural language", "llm", "generative ai",
    "blockchain", "cybersecurity", "penetration testing", "ethical hacking",
]


def is_it_course(name: str, description: str) -> bool:
    text = (name + " " + description).lower()
    return any(kw in text for kw in IT_FILTER_KEYWORDS)


def infer_difficulty(name: str, description: str) -> str:
    """Определяет сложность курса по ключевым словам в названии и описании."""
    text = (name + " " + description).lower()

    advanced_signals = [
        "advanced", "expert", "professional", "mastery", "deep dive",
        "in-depth", "senior", "architecture", "optimization", "production",
        "enterprise", "scalable", "performance", "advanced topics",
    ]
    beginner_signals = [
        "beginner", "introduction", "intro to", "intro for", "getting started",
        "for beginners", "basics", "fundamentals", "foundations", "101",
        "no experience", "no prior", "from scratch", "start with", "first steps",
        "complete guide for beginners", "zero to",
    ]

    is_advanced = any(s in text for s in advanced_signals)
    is_beginner = any(s in text for s in beginner_signals)

    if is_advanced and not is_beginner:
        return "advanced"
    if is_beginner and not is_advanced:
        return "beginner"
    return "intermediate"  # по умолчанию — средний


def load_checkpoint() -> dict:
    if os.path.exists(CHECKPOINT_PATH):
        with open(CHECKPOINT_PATH) as f:
            return json.load(f)
    return {"start": 0, "collected": []}


def save_checkpoint(start: int, collected: list):
    with open(CHECKPOINT_PATH, "w") as f:
        json.dump({"start": start, "collected": collected}, f)


def fetch_ratings_batch(ids: list[str]) -> dict[str, float]:
    """
    Запрашивает рейтинги для списка курсов через courses.v2 API.
    Возвращает {id: rating}.
    """
    if not ids:
        return {}
    ids_str = ",".join(ids)
    url = (
        f"https://api.coursera.org/api/courses.v2"
        f"?ids={ids_str}"
        f"&fields=avgLearnerRating,avgProductRating,enrollmentAvailability"
    )
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        result = {}
        for elem in data.get("elements", []):
            cid = elem.get("id", "")
            rating = (
                elem.get("avgLearnerRating")
                or elem.get("avgProductRating")
                or 0
            )
            result[cid] = round(float(rating), 1)
        return result
    except Exception as e:
        print(f"  [ratings] Ошибка: {e}")
        return {}


def fetch_coursera_courses(max_courses: int = MAX_COURSES):
    checkpoint = load_checkpoint()
    start = checkpoint["start"]
    all_courses = checkpoint["collected"]

    if all_courses:
        print(f"🔄 Продолжаю с чекпоинта: уже собрано {len(all_courses)}, offset={start}")
    else:
        print("🔄 Парсинг Coursera IT-курсов...")

    while len(all_courses) < max_courses:
        url = (
            f"https://api.coursera.org/api/courses.v1"
            f"?start={start}&limit={BATCH_SIZE}"
            f"&fields=name,slug,description,primaryLanguages,domainTypes,difficultyLevel"
        )

        try:
            response = requests.get(url, timeout=15)
            data = response.json()
            elements = data.get("elements", [])

            if not elements:
                print("✅ Больше курсов нет.")
                break

            # Фильтруем IT-курсы из батча
            batch_it = []
            for c in elements:
                name = c.get("name", "")
                desc = c.get("description", "")

                if not desc:
                    continue
                if not is_it_course(name, desc):
                    continue

                # Уровень сложности: сначала из API, если нет — определяем сами
                difficulty = c.get("difficultyLevel", "").lower()
                if difficulty not in ("beginner", "intermediate", "advanced"):
                    difficulty = infer_difficulty(name, desc)

                batch_it.append({
                    "id": c.get("id", ""),
                    "name": name,
                    "description": desc[:1000],
                    "rating": 0,  # обновим ниже
                    "language": c.get("primaryLanguages", ["en"]),
                    "difficulty": difficulty,
                    "url": f"https://www.coursera.org/learn/{c.get('slug', '')}",
                })

            # Обновляем рейтинги для IT-батча
            if batch_it:
                ids = [c["id"] for c in batch_it if c["id"]]
                ratings = fetch_ratings_batch(ids)
                for c in batch_it:
                    c["rating"] = ratings.get(c["id"], 0)

                all_courses.extend(batch_it)
                it_count = len(batch_it)
                total_in_batch = len(elements)
                print(
                    f"  offset={start} | в батче {total_in_batch} → IT: {it_count} "
                    f"| итого: {len(all_courses)}"
                )
            else:
                print(f"  offset={start} | IT-курсов не найдено в батче")

            start += BATCH_SIZE
            save_checkpoint(start, all_courses)
            time.sleep(SLEEP_BETWEEN)

        except Exception as e:
            print(f"❌ Ошибка на offset={start}: {e}")
            print("  Сохраняю прогресс и выхожу...")
            break

    # Сохраняем финальный результат
    final = all_courses[:max_courses]
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(final, f, ensure_ascii=False, indent=2)

    # Удаляем чекпоинт
    if os.path.exists(CHECKPOINT_PATH):
        os.remove(CHECKPOINT_PATH)

    print(f"\n✅ Готово! Сохранено {len(final)} IT-курсов → {OUTPUT_PATH}")

    # Статистика
    with_rating = sum(1 for c in final if c.get("rating", 0) > 0)
    difficulties = {}
    for c in final:
        d = c.get("difficulty", "unknown")
        difficulties[d] = difficulties.get(d, 0) + 1
    print(f"   С рейтингом: {with_rating}/{len(final)}")
    print(f"   Сложность: {difficulties}")

    return final


if __name__ == "__main__":
    fetch_coursera_courses()
