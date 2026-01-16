import random
import copy
from supabase import create_client, Client

# 1. Supabase қосылымы
URL = "https://vemwsjtwffihuoaplayn.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlbXdzanR3ZmZpaHVvYXBsYXluIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUxODgxOCwiZXhwIjoyMDgzMDk0ODE4fQ._X4l0NIW-1C2Gs_8StZSM4XFWgN_RQxWLWmXKNYIm14" 
supabase: Client = create_client(URL, KEY)

def fetch_data():
    print("1. Мәліметтерді базадан жүктеу басталды...")
    subjects = supabase.table("subjects").select("*").execute().data
    rooms = supabase.table("rooms").select("*").execute().data
    staff = supabase.table("staff").select("id, full_name, positions(hierarchy_level)").execute().data
    slots = supabase.table("time_slots").select("*").execute().data
    groups = supabase.table("groups").select("id, name, program_id").execute().data
    prog_subs = supabase.table("program_subjects").select("subject_id, program_id").execute().data
    
    print(f"   - Жүктелді: {len(subjects)} пән, {len(rooms)} аудитория, {len(groups)} топ.")
    return subjects, rooms, staff, slots, groups, prog_subs

class ScheduleOptimizer:
    def __init__(self, subjects, rooms, staff, slots, groups, prog_subs):
        self.subjects = subjects
        self.rooms = rooms
        self.slots = slots
        self.groups = groups
        self.prog_subs = prog_subs
        self.days = [1, 2, 3, 4, 5]
        
        self.lecturers = [s for s in staff if s.get('positions') and s['positions'].get('hierarchy_level') == 4]
        self.practitioners = [s for s in staff if s.get('positions') and s['positions'].get('hierarchy_level') == 5]
        self.all_staff = staff
        
        self.pop_size = 40
        self.generations = 200

    def generate_random_schedule(self):
        schedule = []
        for sub in self.subjects:
            sub_groups = [ps['program_id'] for ps in self.prog_subs if ps['subject_id'] == sub['id']]
            actual_groups = [g['id'] for g in self.groups if g['program_id'] in sub_groups]
            
            if not actual_groups: continue

            l_teacher = random.choice(self.lecturers or self.all_staff)['id']
            
            # Лекция (Ортақ)
            schedule.append({
                "group_ids": actual_groups,
                "sub_id": sub['id'],
                "type": "Lecture",
                "room_id": random.choice(self.rooms)['id'],
                "day": random.choice(self.days),
                "slot": random.randint(1, 10),
                "is_double": False,
                "staff_id": l_teacher
            })

            # Практика (Әр топқа бөлек)
            for g_id in actual_groups:
                p_teacher = random.choice(self.practitioners or self.all_staff)['id']
                schedule.append({
                    "group_ids": [g_id],
                    "sub_id": sub['id'],
                    "type": "Practice",
                    "room_id": random.choice(self.rooms)['id'],
                    "day": random.choice(self.days),
                    "slot": random.randint(1, 9),
                    "is_double": True,
                    "staff_id": p_teacher
                })
        return schedule

    def calculate_fitness(self, schedule):
        penalty = 0
        used_rooms = {}
        used_staff = {}
        used_groups = {}

        for item in schedule:
            slots = [item['slot']]
            if item['is_double']: slots.append(item['slot'] + 1)

            for slot in slots:
                if slot > 10: 
                    penalty += 5000
                    continue

                r_key = (item['day'], slot, item['room_id'])
                s_key = (item['day'], slot, item['staff_id'])
                
                if r_key in used_rooms and used_rooms[r_key] != item['sub_id']:
                    penalty += 2000
                if s_key in used_staff and used_staff[s_key] != item['room_id']:
                    penalty += 2000
                
                used_rooms[r_key] = item['sub_id']
                used_staff[s_key] = item['room_id']

                for g_id in item['group_ids']:
                    g_key = (item['day'], slot, g_id)
                    if g_key in used_groups:
                        penalty += 3000
                    used_groups[g_key] = item['sub_id']

        return 1 / (1 + penalty)

    def evolve(self):
        print("2. Оңтайландыру (Evolution) басталды...")
        population = [self.generate_random_schedule() for _ in range(self.pop_size)]
        
        for gen in range(self.generations):
            population = sorted(population, key=lambda x: self.calculate_fitness(x), reverse=True)
            best_fit = self.calculate_fitness(population[0])
            
            if gen % 20 == 0:
                print(f"   [Ұрпақ {gen}] Fitness: {best_fit:.8f}")
            
            if best_fit >= 1.0:
                print(f"   !!! Оңтайлы кесте табылды!")
                break
            
            next_gen = population[:10]
            while len(next_gen) < self.pop_size:
                parent = copy.deepcopy(random.choice(population[:15]))
                idx = random.randint(0, len(parent)-1)
                parent[idx]['day'] = random.choice(self.days)
                parent[idx]['slot'] = random.randint(1, 9 if parent[idx]['is_double'] else 10)
                parent[idx]['room_id'] = random.choice(self.rooms)['id']
                next_gen.append(parent)
            population = next_gen
            
        return population[0]

def save_to_supabase(optimized_schedule, slots_data):
    print("\n3. Базаны тазалау және жаңа кестені жазу...")
    try:
        supabase.table("schedule_groups").delete().neq("group_id", "00000000-0000-0000-0000-000000000000").execute()
        supabase.table("schedule").delete().neq("semester", 0).execute()

        slot_map = {sl['pair_number']: sl['id'] for sl in slots_data}
        
        for i, item in enumerate(optimized_schedule):
            slot_uuid = slot_map.get(item['slot'])
            if not slot_uuid: continue

            # Schedule сақтау
            main_lesson = {
                "subject_id": item['sub_id'], "teacher_id": item['staff_id'],
                "room_id": item['room_id'], "day_of_week": item['day'],
                "time_slot_id": slot_uuid, "is_lecture": item['type'] == "Lecture",
                "semester": 1, "academic_year": "2025-2026"
            }
            
            res = supabase.table("schedule").insert(main_lesson).execute()
            
            if res.data:
                sch_id = res.data[0]['id']
                group_links = [{"schedule_id": sch_id, "group_id": gid} for gid in item['group_ids']]
                supabase.table("schedule_groups").insert(group_links).execute()

                if item['is_double']:
                    next_slot = slot_map.get(item['slot'] + 1)
                    if next_slot:
                        main_lesson["time_slot_id"] = next_slot
                        res_next = supabase.table("schedule").insert(main_lesson).execute()
                        if res_next.data:
                            sch_id_next = res_next.data[0]['id']
                            group_links_next = [{"schedule_id": sch_id_next, "group_id": gid} for gid in item['group_ids']]
                            supabase.table("schedule_groups").insert(group_links_next).execute()
            
            if i % 50 == 0:
                print(f"   Прогресс: {i}/{len(optimized_schedule)} сабақ өңделді...")

        print("\nСӘТТІ: Кесте толық жаңартылды!")
    except Exception as e:
        print(f"Қате: {e}")

       
# --- ІСКЕ ҚОСУ ---
print("Деректер жүктелуде...")
subjects, rooms, staff, slots, groups, prog_subs = fetch_data()

optimizer = ScheduleOptimizer(subjects, rooms, staff, slots, groups, prog_subs)
print("Оңтайландыру басталды...")
best_schedule = optimizer.evolve()

# Алдын ала дайындалған функцияны шақыру
save_to_supabase(best_schedule, slots)