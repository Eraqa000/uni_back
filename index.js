const express = require('express');
const cors = require('cors');
const { Expo } = require('expo-server-sdk');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { spawn } = require('child_process');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Middleware для проверки JWT и добавления пользователя в запрос
const authenticateUser = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация: токен не предоставлен.' });
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) {
      return res.status(401).json({ error: 'Ошибка авторизации: неверный токен.' });
    }
    req.user = user; // Прикрепляем пользователя к объекту запроса
    next();
  } catch (error) {
    res.status(401).json({ error: 'Ошибка авторизации: неверный токен.' });
  }
};

// Эндпоинт для регистрации Push-токена
app.post('/api/register-push-token', authenticateUser, async (req, res) => {
  const { token: pushToken } = req.body;
  const userId = req.user.id;

  if (!pushToken) {
    return res.status(400).json({ error: 'Push-токен обязателен.' });
  }

  try {
    // Используем upsert: если токен уже существует (уникальное поле), ничего не делаем.
    // Если токен новый, он будет добавлен.
    const { error } = await supabase
      .from('user_push_tokens')
      .upsert(
        { user_id: userId, token: pushToken },
        { onConflict: 'token' } // Поле 'token' имеет UNIQUE ограничение
      );

    if (error) {
      // Если ошибка - это нарушение уникальности, это не является реальной ошибкой для нас.
      // Просто значит, что токен уже зарегистрирован.
      if (error.code === '23505') { // Код ошибки для unique_violation в PostgreSQL
        console.log(`Push-токен ${pushToken.substring(0, 15)}... уже существует.`);
        return res.status(200).json({ message: 'Токен уже зарегистрирован.' });
      }
      // Для всех других ошибок - выводим их в консоль и возвращаем ошибку сервера.
      console.error('Ошибка при сохранении push-токена:', error);
      throw error;
    }

    console.log(`Успешно зарегистрирован push-токен для пользователя ${userId}.`);
    res.status(200).json({ message: 'Токен успешно зарегистрирован.' });
  } catch (error) {
    res.status(500).json({ error: 'Внутренняя ошибка сервера при регистрации токена.' });
  }
});


// Связь с базой через Service Role Key (Admin права)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);


// Инициализация Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

app.get('/', (req, res) => res.send('University Backend is running'));


app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email, password
    });

    if (authError) return res.status(401).json({ error: 'Неверный логин или пароль' });

    // 1. Staff кестесінен іздеу
    let { data: userData, error: userError } = await supabase
        .from('staff')
        .select('full_name, positions(title)')
        .eq('id', authData.user.id)
        .single();

    let rawRole = userData?.positions?.title || 'Студент';
    
    // 2. Рөлді фронтенд күтетін форматқа келтіру (кіші әріпке көшіру)
    let role = rawRole.toLowerCase(); 

    if (userError || !userData) {
        const { data: profileData } = await supabase
            .from('profiles')
            .select('full_name, group_id')
            .eq('id', authData.user.id)
            .single();
        
        if (profileData) {
            userData = profileData;
            role = 'Студент';
        } else {
            return res.status(404).json({ error: 'Профиль не найден' });
        }
    }

    res.status(200).json({
        user: {
            id: authData.user.id,
            full_name: userData.full_name,
            role: role, // Енді бұл жерде "преподаватель (лектор)" болады
            email: authData.user.email,
            group_id: userData.group_id
        },
        session: authData.session
    });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError) throw authError;

    let { data: userData, error: userError } = await supabase
      .from('staff')
      .select('full_name, positions(title)')
      .eq('id', user.id)
      .single();

    let role = userData?.positions?.title.toLowerCase() || 'студент';

    if (userError || !userData) {
      const { data: profileData } = await supabase.from('profiles').select('full_name, group_id').eq('id', user.id).single();
      if (profileData) {
        userData = profileData;
        role = 'студент';
      } else {
        return res.status(404).json({ error: 'Профиль не найден' });
      }
    }

    res.status(200).json({
      id: user.id,
      full_name: userData.full_name,
      role: role,
      email: user.email,
      group_id: userData.group_id,
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/profile/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select(`
                full_name,
                email,
                is_grantee,
                groups (
                    name,
                    course_number,
                    programs (
                        name,
                        departments (
                            name
                        )
                    )
                )
            `)
            .eq('id', req.params.id)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/create-student', async (req, res) => {
    const { email, password, full_name, group_id, is_grantee } = req.body;
    
    try {
        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email, password, email_confirm: true
        });

        if (authError) throw authError;

        const { error: profileError } = await supabase.from('profiles').insert([
            { 
                id: authUser.user.id, 
                full_name, 
                email, 
                group_id, 
                is_grantee: is_grantee,
                // ЛОГИКА: если грант (true), то стипендия (true), иначе (false)
                has_scholarship: is_grantee === true 
            }
        ]);

        if (profileError) throw profileError;
        res.status(200).json({ message: 'Студент создан' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// backend/index.js
app.get('/api/departments', async (req, res) => {
    console.log("Запрос на получение кафедр получен"); // Это лог в терминале бэкенда
    try {
        const { data, error } = await supabase
            .from('departments') // Убедитесь, что здесь нет лишних пробелов
            .select('*');

        if (error) {
            console.error("Ошибка Supabase:", error.message);
            return res.status(400).json({ error: error.message });
        }

        console.log("Кафедры найдены:", data.length);
        res.status(200).json(data);
    } catch (err) {
        console.error("Критическая ошибка сервера:", err);
        res.status(500).json({ error: 'Сервер не смог обработать запрос' });
    }
});


app.get('/api/professions/:deptId', async (req, res) => {
    const { deptId } = req.params;
    try {
        const { data, error } = await supabase
            .from('programs') // В базе таблица называется 'programs'
            .select('*')
            .eq('department_id', deptId);

        if (error) throw error;
        res.status(200).json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/groups/:profId', async (req, res) => {
    const { profId } = req.params;
    console.log("Запрос групп для программы ID:", profId);
    try {
        const { data, error } = await supabase
            .from('groups')
            .select('*')
            // ПРОВЕРЬТЕ НАЗВАНИЕ КОЛОНКИ: profession_id или program_id?
            .eq('program_id', profId); 

        if (error) {
            console.error("Ошибка Supabase:", error.message);
            return res.status(400).json({ error: error.message });
        }

        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Эндпоинт для получения оценок студента по предметам (РК1 и РК2)
// ВАЖНО: Требует создания RPC функции 'get_student_marks' в базе данных Supabase.
app.get('/api/marks/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        // Вызываем твою новую функцию get_student_marks
        const { data, error } = await supabase
            .rpc('get_student_marks', { p_student_id: userId });

        if (error) {
            console.error('Supabase RPC error:', error);
            throw error;
        }
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Эндпоинт для получения расписания группы
app.get('/api/schedule/:groupId', async (req, res) => {
    const { groupId } = req.params;
    try {
        const { data, error } = await supabase
            .from('schedule')
            .select(`
                day_of_week,
                is_lecture,
                subjects ( name ),
                staff ( full_name ),
                rooms ( room_number ),
                time_slots ( pair_number, start_time, end_time ),
                schedule_groups!inner ( group_id )
            `)
            .eq('schedule_groups.group_id', groupId)
            .order('day_of_week')
            .order('time_slots(pair_number)');

        if (error) {
            console.error('Supabase query error:', error);
            throw error;
        }

        // Упрощаем структуру данных для фронтенда
        const formattedData = data.map(item => ({
            day_of_week: item.day_of_week,
            type: item.is_lecture ? 'Лекция' : 'Семинар',
            subject: item.subjects.name,
            teacher: item.staff.full_name,
            room: item.rooms.room_number,
            pair: item.time_slots.pair_number,
            time: `${item.time_slots.start_time.slice(0, 5)} - ${item.time_slots.end_time.slice(0, 5)}`
        }));
        
        res.status(200).json(formattedData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.post('/api/mass-register', async (req, res) => {
    const { profession_id, course, prefix, students } = req.body;
    
    // 1. Формируем учебный год для обхода not-null constraint
    const currentYear = new Date().getFullYear();
    const academicYear = `${currentYear}-${currentYear + 1}`;
    const yearSuffix = currentYear.toString().slice(-2);
    const MAX_PER_GROUP = 30;

    try {
        const totalStudents = students.length;
        const numGroups = Math.ceil(totalStudents / MAX_PER_GROUP);
        let registeredData = [];

        for (let i = 1; i <= numGroups; i++) {
            const groupName = `${prefix}-${yearSuffix}${course}${i.toString().padStart(2, '0')}`;

            // 2. ПРОВЕРКА НА ДУБЛИКАТ ИМЕНИ ГРУППЫ
            let { data: existingGroup } = await supabase
                .from('groups')
                .select('id')
                .eq('name', groupName)
                .maybeSingle();

            let groupId;

            if (existingGroup) {
                groupId = existingGroup.id;
                console.log(`Используем существующую группу: ${groupName}`);
            } else {
                // 3. СОЗДАНИЕ НОВОЙ ГРУППЫ (с academic_year)
                const { data: newGroup, error: groupErr } = await supabase
                    .from('groups')
                    .insert([{ 
                        name: groupName, 
                        program_id: profession_id, 
                        course_number: parseInt(course),
                        academic_year: academicYear 
                    }])
                    .select().single();

                if (groupErr) throw groupErr;
                groupId = newGroup.id;
                console.log(`Создана новая группа: ${groupName}`);
            }

            const batch = students.slice((i - 1) * MAX_PER_GROUP, i * MAX_PER_GROUP);

            for (const s of batch) {
                // 4. Создание пользователя в Auth
                const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
                    email: s.email,
                    password: s.password,
                    email_confirm: true,
                    user_metadata: { full_name: s.full_name }
                });

                if (authErr) {
                    console.error(`Пропуск ${s.email}: ${authErr.message}`);
                    continue; 
                }

                // 5. Вставка в профили
                await supabase.from('profiles').insert([{
                    id: authUser.user.id,
                    full_name: s.full_name,
                    email: s.email,
                    group_id: groupId
                }]);

                registeredData.push({
                    full_name: s.full_name,
                    email: s.email,
                    password: s.password,
                    group_name: groupName
                });
            }
        }

        res.status(201).json({ success: true, data: registeredData });
    } catch (error) {
        console.error("Ошибка:", error);
        res.status(400).json({ error: error.message });
    }
});

// Получение списка должностей
app.get('/api/positions', async (req, res) => {
    const { data, error } = await supabase.from('positions').select('*').order('hierarchy_level');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

// Создание сотрудника
app.post('/api/create-staff', async (req, res) => {
    const { email, password, full_name, position_id, department_id } = req.body;
    
    try {
        // 1. Создаем в Auth
        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email, password, email_confirm: true
        });
        if (authError) throw authError;

        // 2. Создаем в таблице staff
        const { error: staffError } = await supabase.from('staff').insert([{ 
            id: authUser.user.id, 
            full_name, 
            email, 
            position_id, 
            department_id 
        }]);

        if (staffError) throw staffError;
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Эндпоинт для статистики факультета (админ-панель)
app.get('/api/admin/faculty-stats', async (req, res) => {
    try {
        // Считаем студентов
        const { count: studentCount } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        // Считаем группы
        const { count: groupCount } = await supabase
            .from('groups')
            .select('*', { count: 'exact', head: true });

        // Считаем преподавателей (те, у кого уровень иерархии 4, 5 или 6)
        const { count: teacherCount } = await supabase
            .from('staff')
            .select('*, positions!inner(hierarchy_level)', { count: 'exact', head: true })
            .in('positions.hierarchy_level', [4, 5, 6]);

        res.json({
            students: studentCount || 0,
            groups: groupCount || 0,
            teachers: teacherCount || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/risk-analysis', async (req, res) => {
    try {
        // 1. Получаем список студентов, у которых есть оценки ниже 50 баллов
        const { data: lowMarks, error } = await supabase
            .from('weekly_marks')
            .select(`
                seminar_mark, 
                lecture_mark, 
                profiles ( full_name, groups ( name ) ),
                subjects ( name )
            `)
            .or('seminar_mark.lt.50,lecture_mark.lt.50')
            .limit(10); // Берем топ-10 проблемных случаев для анализа

        if (error) throw error;

        const context = lowMarks.map(m => 
            `${m.profiles.full_name} (${m.profiles.groups.name}) по предмету "${m.subjects.name}": ${m.seminar_mark}/100`
        ).join('\n');

        // 2. Запрос к Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const prompt = `Ты — аналитик деканата. У тебя есть список студентов с низкой успеваемостью:\n${context}\n
        Дай краткое резюме (3-4 предложения): какая основная проблема и какую рекомендацию дать эдвайзерам.`;

        const result = await model.generateContent(prompt);
        res.json({ report: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.use((req, res, next) => {
    console.log(`${req.method} запрос на ${req.url}`);
    next();
});

app.post('/api/ai/chat', async (req, res) => {
    console.log("1. Запрос получен. Тело:", req.body);
    const { userId, message } = req.body;

    if (!userId || !message) {
        return res.status(400).json({ error: "Не указан userId или message" });
    }

    try {
        // 1. Получаем контекст студента
        console.log("2. Загрузка данных из Supabase...");
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select(`
                full_name,
                groups ( name ),
                weekly_marks (
                    seminar_mark, 
                    lecture_mark, 
                    srs_mark, 
                    subjects ( name )
                )
            `)
            .eq('id', userId)
            .single();

        if (profileError) throw profileError;

        // 2. Получаем историю и ПРАВИЛЬНО форматируем её
        const { data: history } = await supabase
            .from('chat_history')
            .select('role, message')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(6);

        // Переворачиваем, чтобы был хронологический порядок
        let formattedHistory = history ? history.reverse().map(h => ({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: h.message }],
        })) : [];

        // ХАК ДЛЯ GEMINI: История ОБЯЗАНА начинаться с 'user'
        // Если первое сообщение от модели — удаляем его из контекста
        if (formattedHistory.length > 0 && formattedHistory[0].role === 'model') {
            console.log("Удалено первое сообщение истории (роль 'model'), чтобы избежать ошибки SDK");
            formattedHistory.shift();
        }

        // 3. Сводка по оценкам
        const marksSummary = profile?.weekly_marks?.map(m => 
            `${m.subjects?.name || 'Предмет'}: Сем-${m.seminar_mark}, Лек-${m.lecture_mark}`
        ).join('; ') || "Данных нет.";

        // 4. Инструкция
        const systemInstruction = `Ты — AI-ассистент университета 'Univer'. 
        Собеседник: ${profile?.full_name}. Группа: ${profile?.groups?.name}.
        Успеваемость: ${marksSummary}.
        Твоя задача: анализировать оценки и отвечать на вопросы. Будь краток.`;

        console.log("3. Отправка запроса в Gemini...");

        const studentModel = genAI.getGenerativeModel({ 
            model: "gemini-3-flash-preview" 
        });

        const chat = studentModel.startChat({
            history: formattedHistory,
        });

        // Вставляем системную инструкцию перед вопросом пользователя
        const fullPrompt = `System Instruction: ${systemInstruction}\n\nUser Question: ${message}`;
        
        const result = await chat.sendMessage(fullPrompt);
        const aiResponse = result.response.text();

        console.log("4. Ответ получен!");

        // 5. Сохранение в базу данных
        await supabase.from('chat_history').insert([
            { user_id: userId, role: 'user', message: message },
            { user_id: userId, role: 'model', message: aiResponse }
        ]);

        res.status(200).json({ reply: aiResponse });

    } catch (error) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА:", error);
        res.status(500).json({ error: "Ошибка ассистента. Попробуйте позже." });
    }
});

// Эндпоинт для получения истории сообщений при открытии чата
app.get('/api/ai/history/:userId', async (req, res) => {
    const { data, error } = await supabase
        .from('chat_history')
        .select('*')
        .eq('user_id', req.params.userId)
        .order('created_at', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

app.get('/api/ai/analyze-performance/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        // 1. Собираем подробные данные: Профиль + Оценки + Грант
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select(`
                full_name,
                is_grantee,
                groups ( name ),
                weekly_marks (
                    seminar_mark, 
                    lecture_mark, 
                    srs_mark, 
                    subjects ( name )
                )
            `)
            .eq('id', userId)
            .single();

        if (profileError) throw profileError;

        // 2. Формируем текст для анализа
        const marksData = profile.weekly_marks.map(m => 
            `- ${m.subjects.name}: Сем: ${m.seminar_mark}, Лек: ${m.lecture_mark}, СРС: ${m.srs_mark}`
        ).join('\n');

        const prompt = `
            Ты — эксперт-аналитик университета. Проанализируй успеваемость студента и дай советы.
            Студент: ${profile.full_name}
            Группа: ${profile.groups?.name}
            Статус: ${profile.is_grantee ? 'Обучается на гранте' : 'Платное отделение'}
            
            Данные по оценкам:
            ${marksData}

            Твой отчет должен состоять из 3 кратких блоков:
            1. Текущий статус (средний балл и общая картина).
            2. Зоны риска (предметы, где оценки ниже 70 или есть пропуски).
            3. Рекомендации (что именно нужно сделать, чтобы сохранить грант или улучшить GPA).
            
            Пиши профессионально, но воодушевляюще. Используй эмодзи для акцентов, не давай ложные данные если не предоставлено текущие данные.
        `;

        // 3. Запрос к Gemini
        const studentModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const result = await studentModel.generateContent(prompt);
        const analysis = result.response.text();

        res.json({ analysis });

    } catch (error) {
        console.error("Ошибка анализа:", error);
        res.status(500).json({ error: "Не удалось провести анализ" });
    }
});


// 1. Барлық топтар тізімін алу (Замдекан кесте таңдау үшін)
app.get('/api/admin/groups', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('groups')
            .select('id, name')
            .order('name', { ascending: true });

        if (error) throw error;
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Кестеден нақты бір сабақты өшіру
app.delete('/api/admin/schedule/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Алдымен schedule_groups-тан өшіру (егер Cascade delete қосылмаған болса)
        await supabase
            .from('schedule_groups')
            .delete()
            .eq('schedule_id', id);

        // Сосын негізгі кестеден өшіру
        const { error } = await supabase
            .from('schedule')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Занятие удалено' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Сабақты қолмен қосу (Create Lesson үшін)
app.post('/api/admin/create-lesson', async (req, res) => {
    const { subject_id, teacher_id, room_id, group_id, day_of_week, time_slot_id, is_lecture } = req.body;

    try {
        // 1. schedule кестесіне сабақ қосу
        const { data: newSchedule, error: schedError } = await supabase
            .from('schedule')
            .insert([{
                subject_id,
                teacher_id,
                room_id,
                day_of_week,
                time_slot_id,
                is_lecture,
                semester: 1, // Әдепкі бойынша 1-семестр
                academic_year: "2025-2026"
            }])
            .select()
            .single();

        if (schedError) throw schedError;

        // 2. Жаңа сабақты топпен байланыстыру
        const { error: groupLinkError } = await supabase
            .from('schedule_groups')
            .insert([{
                schedule_id: newSchedule.id,
                group_id: group_id
            }]);

        if (groupLinkError) throw groupLinkError;

        res.status(201).json({ success: true, data: newSchedule });
    } catch (err) {
        console.error("Manual create error:", err);
        res.status(400).json({ error: err.message });
    }
});

// 4. Аудиториялардың бостығын тексеру (Конфликт болмауы үшін)
app.get('/api/admin/check-room', async (req, res) => {
    const { room_id, day, slot_id } = req.query;
    try {
        const { data, error } = await supabase
            .from('schedule')
            .select('id')
            .eq('room_id', room_id)
            .eq('day_of_week', day)
            .eq('time_slot_id', slot_id);

        if (error) throw error;
        // Егер дерек бар болса, демек орын бос емес
        res.json({ isAvailable: data.length === 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/generate-schedule', authenticateUser, async (req, res) => {
    // Получаем роль пользователя из предыдущего middleware
    const { data: userData, error: userError } = await supabase
        .from('staff')
        .select('positions(title)')
        .eq('id', req.user.id)
        .single();

    if (userError || !userData || !userData.positions) {
        return res.status(403).json({ error: 'Не удалось определить вашу роль.' });
    }

    const userRole = userData.positions.title.toLowerCase();

    // Проверяем, является ли пользователь замдекана
    if (userRole !== 'заместитель декана') {
        return res.status(403).json({ error: 'Доступ запрещен. Только замдекана может генерировать расписание.' });
    }

    console.log('Запуск генерации расписания...');
    const pythonProcess = spawn('python3', ['main.py']);

    let output = '';
    pythonProcess.stdout.on('data', (data) => {
        console.log(`[Python Script]: ${data}`);
        output += data.toString();
    });

    let errorOutput = '';
    pythonProcess.stderr.on('data', (data) => {
        console.error(`[Python Script Error]: ${data}`);
        errorOutput += data.toString();
    });

    pythonProcess.on('close', (code) => {
        console.log(`[Python Script] завершился с кодом ${code}`);
        if (code === 0) {
            res.status(200).json({ 
                message: 'Расписание успешно сгенерировано и сохранено в базе данных.',
                details: output
            });
        } else {
            res.status(500).json({ 
                error: 'Ошибка при выполнении скрипта генерации расписания.',
                details: errorOutput
            });
        }
    });

    pythonProcess.on('error', (err) => {
        console.error('Не удалось запустить Python скрипт:', err);
        res.status(500).json({ error: 'Не удалось запустить процесс генерации расписания.' });
    });
});

app.get('/api/teacher/schedule/:teacherId', async (req, res) => {
    const { teacherId } = req.params;

    try {
        const { data, error } = await supabase
            .from('schedule')
            .select(`
                id,
                subject_id,
                day_of_week,
                is_lecture,
                subjects (name),
                rooms (room_number),
                time_slots (start_time, end_time, pair_number),
                schedule_groups (
                    groups (id, name)
                )
            `)
            .eq('teacher_id', teacherId)
            // Алдымен күн бойынша, сосын уақыт (пара саны) бойынша сұрыптаймыз
            .order('day_of_week', { ascending: true })
            .order('time_slot_id', { ascending: true }); 

        if (error) throw error;

        const formattedData = data.map(item => ({
            id: item.id,
            subject_id: item.subject_id,
            day_of_week: item.day_of_week,
            subject: item.subjects?.name || 'Пән аты жоқ',
            room: item.rooms?.room_number || 'Ауд. белгісіз',
            time: item.time_slots 
                ? `${item.time_slots.start_time.slice(0, 5)} - ${item.time_slots.end_time.slice(0, 5)}` 
                : 'Уақыты жоқ',
            pair: item.time_slots?.pair_number || 0,
            is_lecture: item.is_lecture,
            // Студенттерді белгілеу үшін топтардың ID-лері маңызды
            groups: item.schedule_groups ? item.schedule_groups.map(sg => sg.groups) : []
        }));

        res.json(formattedData);
    } catch (err) {
        console.error("Schedule Error:", err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/teacher/dashboard/:teacherId', async (req, res) => {
    const { teacherId } = req.params;
    const today = new Date().getDay(); // Бүгінгі апта күні (1-5)

    try {
        // 1. Бүгінгі сабақтарын алу
        const { data: todaySchedule } = await supabase
            .from('schedule')
            .select(`
                id,
                is_lecture,
                subjects (name),
                rooms (room_number),
                time_slots (start_time, end_time, pair_number)
            `)
            .eq('teacher_id', teacherId)
            .eq('day_of_week', today);

        // 2. Мұғалімге бекітілген жалпы топтар санын анықтау
        const { data: totalGroups } = await supabase
            .from('schedule')
            .select('schedule_groups (group_id)')
            .eq('teacher_id', teacherId);

        // Универсалды топтар санын есептеу
        const uniqueGroups = new Set(totalGroups.flatMap(s => s.schedule_groups.map(g => g.group_id)));

        res.json({
            today_lessons: todaySchedule || [],
            stats: {
                total_lessons_week: totalGroups.length,
                total_groups: uniqueGroups.size
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// backend/index.js
app.post('/api/teacher/mark-attendance', async (req, res) => {
    const { schedule_id, date, attendance_data } = req.body;

    try {
        // 1. Алдымен осы күнге бұл сабаққа белгі қойылған ба, тексереміз (қайталанбауы үшін)
        // Бұл қадамды қоспасаң, мұғалім екі рет басса, дубликат болады
        await supabase
            .from('attendance')
            .delete()
            .eq('schedule_id', schedule_id)
            .eq('date', date);

        // 2. Жаңа мәліметтерді дайындау
        const insertData = attendance_data.map(item => ({
            schedule_id: schedule_id,
            student_id: item.student_id,
            status: item.status,
            date: date
        }));

        // 3. Пакеттік жазу
        const { error } = await supabase
            .from('attendance')
            .insert(insertData);

        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Сабаққа қатысты студенттер тізімін алу (MarkAttendance бетіне қажет)
app.get('/api/teacher/lesson-students/:scheduleId', async (req, res) => {
    const { scheduleId } = req.params;

    try {
        // 1. Сабақ арқылы топтарды табамыз
        const { data: scheduleGroups, error: groupError } = await supabase
            .from('schedule_groups')
            .select('group_id')
            .eq('schedule_id', scheduleId);

        if (groupError) throw groupError;

        const groupIds = scheduleGroups.map(sg => sg.group_id);

        // 2. Сол топтағы студенттерді (profiles) аламыз
        const { data: students, error: studentError } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('group_id', groupIds)
            .order('full_name', { ascending: true });

        if (studentError) throw studentError;

        res.json(students);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Инициализация Expo SDK
const expo = new Expo();

// --- Функция отправки уведомлений о новых оценках ---
async function sendNewMarksNotifications(marks, subject_id, week_number) {
    console.log(`Запуск отправки уведомлений для ${marks.length} студентов.`);
    
    try {
        // 1. Получаем название предмета
        const { data: subject, error: subjectError } = await supabase
            .from('subjects')
            .select('name')
            .eq('id', subject_id)
            .single();
        if (subjectError) throw new Error('Предмет не найден');
        const subjectName = subject.name;

        // 2. Собираем ID студентов
        const studentIds = marks.map(m => m.student_id);
        if (studentIds.length === 0) return;

        // 3. Находим все push-токены этих студентов
        const { data: tokens, error: tokenError } = await supabase
            .from('user_push_tokens')
            .select('user_id, token')
            .in('user_id', studentIds);
        
        if (tokenError || !tokens || tokens.length === 0) {
            console.log('Не найдены push-токены для указанных студентов.');
            return;
        }

        // 4. Создаем сообщения
        let messages = [];
        for (const markRecord of marks) {
            // Находим все токены для конкретного студента
            const studentTokens = tokens.filter(t => t.user_id === markRecord.student_id);
            for (const t of studentTokens) {
                const pushToken = t.token;
                // Проверяем, валиден ли токен
                if (!Expo.isExpoPushToken(pushToken)) {
                    console.error(`Push-токен ${pushToken} не является валидным.`);
                    continue;
                }
                
                // Формируем сообщение (берем семинарскую оценку как основную)
                const markValue = markRecord.seminar_mark || 0;

                messages.push({
                    to: pushToken,
                    sound: 'default',
                    title: `Новая оценка!`,
                    body: `Предмет: "${subjectName}" (Неделя ${week_number}). Ваша оценка: ${markValue}`,
                    data: { type: 'new_mark', subjectId: subject_id },
                });
            }
        }
        
        if (messages.length === 0) {
            console.log("Нет сообщений для отправки.");
            return;
        }

        // 5. Отправляем уведомления порциями (чанками)
        let chunks = expo.chunkPushNotifications(messages);
        let tickets = [];

        for (let chunk of chunks) {
            let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
            console.log("Отправлена порция уведомлений:", ticketChunk);
        }

        // TODO: Можно добавить обработку ответа (tickets) для удаления невалидных токенов из БД

    } catch (error) {
        console.error('--- Ошибка в функции отправки уведомлений: ---', error);
    }
}


app.post('/api/teacher/save-weekly-marks', async (req, res) => {
    const { subject_id, week_number, marks } = req.body;

    try {
        const insertData = marks.map(m => ({
            student_id: m.student_id,
            subject_id: subject_id,
            week_number: week_number,
            seminar_mark: m.seminar_mark,
            lecture_mark: m.lecture_mark,
            srs_mark: m.srs_mark
        }));

        // upsert - если запись есть, обновляет, если нет - создает
        const { error } = await supabase
            .from('weekly_marks')
            .upsert(insertData, { onConflict: 'student_id, subject_id, week_number' });

        if (error) throw error;
        
        // --- ОТПРАВКА УВЕДОМЛЕНИЙ ---
        // Вызываем функцию отправки в фоновом режиме, не дожидаясь ответа,
        // чтобы не задерживать ответ преподавателю.
        sendNewMarksNotifications(marks, subject_id, week_number);
        // -------------------------

        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ЕЖЕНЕДЕЛЬНЫЙ АНАЛИЗ ДЛЯ ПРЕПОДАВАТЕЛЕЙ ---

async function sendWeeklyTeacherAnalysis() {
    console.log('--- [CRON] Запуск еженедельного анализа для преподавателей ---');

    try {
        // 1. Находим данные по студентам в зоне риска за последнюю неделю
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        
        const { data: lowMarks, error: marksError } = await supabase
            .from('weekly_marks')
            .select(`
                seminar_mark,
                created_at,
                profiles ( full_name, groups ( name ) ),
                subjects ( name )
            `)
            .lt('seminar_mark', 60) // Порог "низкой" оценки
            .gte('created_at', oneWeekAgo); // Только за последнюю неделю

        if (marksError) throw marksError;

        if (!lowMarks || lowMarks.length === 0) {
            console.log('[CRON] Студенты с низкой успеваемостью за неделю не найдены. Отправка отчета отменена.');
            return;
        }
        
        // 2. Формируем контекст для Gemini
        const context = lowMarks.map(m => 
            `- ${m.profiles.full_name} (${m.profiles.groups.name}) по предмету "${m.subjects.name}": ${m.seminar_mark} баллов.`
        ).join('\n');

        const prompt = `Ты — методист деканата. Подготовь краткий (2-3 предложения) еженедельный отчет для преподавательского состава на основе следующих данных о студентах с низкой успеваемостью за последнюю неделю:\n\n${context}\n\nСделай акцент на общей тенденции и дай одну главную рекомендацию для кураторов.`;

        // 3. Генерируем отчет с помощью Gemini
        const result = await model.generateContent(prompt);
        const reportText = result.response.text();

        console.log('[CRON] Сгенерирован отчет от Gemini:', reportText);

        // 4. Находим всех преподавателей и их push-токены
        const { data: teachers, error: teacherError } = await supabase
            .from('staff')
            .select(`
                id, 
                full_name,
                positions!inner(title)
            `)
            // .ilike регистрге қарамайды. "Преподаватель" сөзі бар кез келген лауазымды табады
            .ilike('positions.title', '%преподаватель%');

        if (teacherError) {
            console.error('[CRON] Қызметкерлерді алу қатесі:', teacherError);
            return;
        }

        if (!teachers || teachers.length === 0) {
            console.log('[CRON] Базадан "преподаватель" лауазымымен ешкім табылмады.');
            return;
        }

        const teacherIds = teachers.map(t => t.id);
        console.log(`[CRON] Табылған мұғалімдер ID-лері: ${teacherIds}`);
        
        const { data: tokens, error: tokenError } = await supabase
            .from('user_push_tokens')
            .select('token')
            .in('user_id', teacherIds);

        if (tokenError || !tokens || tokens.length === 0) {
            console.log('[CRON] Push-токены преподавателей не найдены.');
            return;
        }

        // 5. Отправляем уведомления
        let messages = [];
        for (const t of tokens) {
            if (Expo.isExpoPushToken(t.token)) {
                messages.push({
                    to: t.token,
                    sound: 'default',
                    title: 'Еженедельный AI-анализ успеваемости',
                    body: reportText
                });
            }
        }
        
        if (messages.length > 0) {
            let chunks = expo.chunkPushNotifications(messages);
            for (let chunk of chunks) {
                await expo.sendPushNotificationsAsync(chunk);
            }
            console.log(`[CRON] Еженедельный отчет успешно отправлен ${messages.length} преподавателям.`);
        }

    } catch (error) {
        console.error('[CRON] Ошибка при создании еженедельного отчета:', error);
    }
}

// Запускаем задачу каждую пятницу в 18:00
cron.schedule('10 20 * * 6', sendWeeklyTeacherAnalysis, {
    scheduled: true,
    timezone: "Asia/Almaty" // Укажем нашу таймзону
});


app.listen(process.env.PORT, () => console.log(`Server on port ${process.env.PORT}`));