// Arabic strings. Usernames stay Latin-script everywhere (a-z, 0-9, ., _ —
// see src/lib/username.ts), so example usernames in placeholders are kept
// as-is rather than transliterated.
export default {
  common: {
    username: 'اسم المستخدم',
    usernamePlaceholder: 'مثال: ahmed_h',
    cancel: 'إلغاء',
    save: 'حفظ',
    signIn: 'تسجيل الدخول',
  },
  auth: {
    landing: {
      tagline: 'وزّع المهام وتابعها ضمن فريقك، مقسّمة إلى مجموعات لكل منها مسؤولها الخاص.',
      createOrgTitle: 'إنشاء مؤسسة',
      createOrgSubtitle: 'ستكون المالك، وتُنشئ الفرق وتضيف الأشخاص.',
      alreadyHaveAccount: 'هل لديك حساب بالفعل؟',
    },
    create: {
      title: 'أنشئ مؤسستك',
      subtitle: 'ستحصل على رقم تعريف فريد لمؤسستك لمشاركته مع فريقك حتى ينضموا إليه.',
      orgNameLabel: 'اسم المؤسسة',
      orgNamePlaceholder: 'مثال: مطعم البصرة',
      yourNameLabel: 'اسمك',
      yourNamePlaceholder: 'مثال: أحمد',
      usernameHint: 'ستستخدم هذا (مع رقم تعريف مؤسستك) لتسجيل الدخول في المرة القادمة — لا حاجة لإعادة كتابة بريدك الإلكتروني.',
      emailLabel: 'البريد الإلكتروني',
      passwordLabel: 'كلمة المرور',
      passwordPlaceholder: '6 أحرف على الأقل',
      submit: 'إنشاء المؤسسة',
      genericError: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
    },
    signin: {
      title: 'تسجيل الدخول',
      subtitle: 'استخدم رقم تعريف المؤسسة واسم المستخدم اللذين أعددتهما عند انضمامك.',
      orgIdLabel: 'رقم تعريف المؤسسة',
      orgIdPlaceholder: 'مثال: 48213',
      passwordLabel: 'كلمة المرور',
      passwordPlaceholder: 'كلمة المرور الخاصة بك',
      genericError: 'تعذر تسجيل الدخول. تحقق من بياناتك وحاول مرة أخرى.',
    },
    verify: {
      title: 'تحقق من بريدك الإلكتروني',
      subtitle: 'أرسلنا رمزًا مكوّنًا من {{length}} أرقام إلى {{email}}. أدخله أدناه لإكمال إعداد حسابك.',
      defaultInbox: 'بريدك الإلكتروني',
      genericError: 'الرمز غير صحيح. يرجى المحاولة مرة أخرى.',
      resendNotice: 'تم إرسال رمز جديد.',
      resendError: 'تعذر إرسال رمز آخر. يرجى الانتظار دقيقة والمحاولة مرة أخرى.',
      resendCooldown: 'إعادة الإرسال خلال {{seconds}} ثانية',
      resendNow: 'إرسال رمز جديد',
    },
  },
} as const;
