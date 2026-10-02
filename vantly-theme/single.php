<?php get_header(); ?>
<?php while (have_posts()) : the_post(); ?>
    <header class="page-header" style="padding-bottom:0; max-width:760px; margin:0 auto; text-align:left;">
        <nav class="breadcrumbs" style="font-size: 13.5px; color: var(--faint); margin-bottom: 28px; display: flex; align-items: center; gap: 10px; font-weight: 500;">
            <a href="<?php echo esc_url(home_url('/')); ?>" style="color: var(--dim); text-decoration: none; transition: color 0.2s;">Home</a>
            <span style="opacity: 0.5;">/</span>
            <a href="<?php echo esc_url(home_url('/insights/')); ?>" style="color: var(--dim); text-decoration: none; transition: color 0.2s;">Insights</a>
            <span style="opacity: 0.5;">/</span>
            <?php 
            $categories = get_the_category();
            if ( ! empty( $categories ) ) {
                echo '<a href="' . esc_url( get_category_link( $categories[0]->term_id ) ) . '" style="color: var(--dim); text-decoration: none; transition: color 0.2s;">' . esc_html( $categories[0]->name ) . '</a>';
                echo '<span style="opacity: 0.5;">/</span>';
            }
            ?>
            <span style="color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;"><?php the_title(); ?></span>
        </nav>
        
        <h1 style="font-size: clamp(34px, 5vw, 46px); text-align: left; margin-bottom: 24px; line-height: 1.15; letter-spacing: -0.02em;"><?php the_title(); ?></h1>
        
        <div style="display:flex; align-items:center; gap: 14px; margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--border);">
            <div style="width: 44px; height: 44px; border-radius: 50%; background: var(--surface2); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-family: var(--fd); font-weight: bold; color: var(--accent); font-size: 16px;">
                V
            </div>
            <div>
                <p style="margin: 0 0 2px; font-weight: 600; color: var(--text); font-size: 14.5px;">Vantly Editorial Team</p>
                <p style="margin: 0; color: var(--faint); font-size: 13px;"><?php echo esc_html(get_the_date()); ?> &middot; <?php echo ceil(str_word_count(strip_tags(get_the_content())) / 250); ?> min read</p>
            </div>
        </div>
    </header>

    <?php if (has_post_thumbnail()) : ?>
        <div style="max-width:960px;margin:48px auto 0;padding:0 24px;">
            <div style="width:100%;height:460px;overflow:hidden;border-radius:20px; border: 1px solid var(--border); box-shadow: 0 10px 40px -10px rgba(0,0,0,0.4);">
                <?php the_post_thumbnail('full', ['style' => 'width:100%;height:100%;object-fit:cover;display:block;']); ?>
            </div>
        </div>
    <?php endif; ?>

    <article id="post-<?php the_ID(); ?>" <?php post_class('page-content'); ?> style="padding-top: 60px; font-size: 17px; line-height: 1.8;">
        <?php the_content(); ?>
    </article>
    
    <div style="max-width: 760px; margin: 0 auto 120px; padding: 48px 32px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); text-align: center; box-shadow: 0 10px 30px -10px rgba(0,0,0,0.2);">
        <span style="display:inline-block; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); background: rgba(226,146,74,.1); border: 1px solid rgba(226,146,74,.25); border-radius: 100px; padding: 6px 14px; margin-bottom: 20px;">Ready to grow?</span>
        <h3 style="font-family: var(--fd); font-size: 26px; color: var(--text); margin-bottom: 16px;">Scale your marketing with Vantly</h3>
        <p style="color: var(--dim); margin-bottom: 32px; font-size: 16px;">Generate copy, graphics, video and emails that actually sound like your brand, all in one unified workspace.</p>
        <a href="https://vantly-xi.vercel.app/signup" style="display: inline-block; background: var(--accent); color: var(--bg); font-weight: 700; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-size: 15px; transition: opacity 0.2s;">Start free today &rarr;</a>
    </div>
<?php endwhile; ?>
<?php get_footer(); ?>