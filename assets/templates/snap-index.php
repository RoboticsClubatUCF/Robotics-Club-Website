<?php
  include_once('assets/templates/slideshows.php');
  $slideshowGen = new Slideshows();
  
  include_once('assets/templates/footer.php');
  $footerGen = new Footer();
?>


<body>  
  <div class="page-container">
  <!-- Navbar -->
  <div class="fixed-top">
    <nav class="navbar navbar-expand-lg navbar-dark bg-clear text-right" id="navigation bar">
      <div class="container">
        <!-- logo and name -->
          <a class="navbar-brand" href="/">
            <div class="nav-img">
              <img src="/assets/imgs/header/roboskull-white.png" alt="club logo white">
              <img class="overlay" src="/assets/imgs/header/roboskull-gold.png" loading="lazy" alt="club logo gold">
              <div class="d-none d-md-block" id="nav-logo-text" aria-label="navigation-logo-text">Robotics Club of Central Florida</div>
              <div class="d-none d-block d-md-none">&nbsp;</div>
            </div>
          </a>
          <!-- navigation links -->
        <button class="navbar-toggler navbar-toggler-right" type="button" data-toggle="collapse" data-target="#navbarResponsive" aria-controls="navbarResponsive" aria-expanded="false" aria-label="Toggle navigation">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="navbarResponsive">
          <ul class="navbar-nav ml-auto">
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" id="navbarDropdownPages" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                About
              </a>
              <div class="dropdown-menu dropdown-menu-right" aria-labelledby="navbarDropdownPages">
                <a class="dropdown-item" href="/about/index">About Us</a>
                <a class="dropdown-item" href="/about/contact">Contact Us</a>
                <a class="dropdown-item" href="/about/constitution">Constitution</a>
              </div>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="/projects/index">Projects</a>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="/announcements/index">Announcements</a>
            </li>
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" id="navbarDropdownPages" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                News
              </a>
              <div class="dropdown-menu dropdown-menu-right" aria-labelledby="navbarDropdownPages">
                <a class="dropdown-item" href="/news/index">Newsletter</a>
                <a class="dropdown-item" href="/news/social-media">Social Media Feed</a>
                <a class="dropdown-item" href="https://us11.campaign-archive.com/home/?u=ba5c2944886feb2964a80fe11&id=e63d752fa6">News Archive</a>
              </div>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="/sponsors/index">Sponsors</a>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="/faq/index">FAQ</a>
            </li>
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" id="navbarDropdownPages" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                More
              </a>
              <div class="dropdown-menu dropdown-menu-right" aria-labelledby="navbarDropdownPages">
                <a class="dropdown-item" href="/more/gallery">Photo Gallery</a>
                <div id="theme-toggle">
                  <label for="toggle-dark">Dark Mode
                  <div class="switch">
                    <input type="checkbox" id="toggle-dark">
                    <div class="slider round" id="switch-toggle"></div>
                  </div>
                  </label>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  </div>
  <!-- /.navbar -->


  <!-- snap container for page -->
  <div class="snapper y mandatory-snapping">
    <!-- snap slideshow and news -->
    <div class="snap-child justify-content-center align-items-center">
      <?php
        $images = array("assets/imgs/home/roboticsSlide.jpg", "assets/imgs/home/innovationSlide.jpg", "assets/imgs/home/successSlide.jpg");
        $slideshowGen->generateWideSlideshow(3, $images, array("Robotics", "Innovation", "Success"));
      ?>

      <!-- Page Content Container 1 -->
      <div class="container">
        <?php
          include_once('assets/templates/announcement-calendar.html')
        ?>
      </div>
      <!-- /.container 1 -->
    </div>
    <!-- snap slideshow and news -->


    <!-- who are we snap container -->
    <div class="snap-child justify-content-center align-items-center">
    <!-- Page Content Container 2 -->
      <div class="container justify-content-center align-items-center">
        <!-- flex containers -->
        <div class="intermediate-container-flex justify-content-center align-items-center">
          <div class="d-flex flex-column justify-content-center align-items-center">
            <!-- intro -->
            <div class="intro justify-content-center align-items-center">
              <!-- title row -->
              <div class="row w-100 no-gutters">
                <div class="col-lg-12">
                  <h2 class="text-center p-2 rounded title-blk-wht w-100 font-weight-bold">Who Are We?</h2>
                </div>
              </div>
              <!-- /.title row -->
              <!-- content row -->
              <div class="row w-100 h-100 no-gutters">
                <div class="col-lg-12">
                  <div class="text-center p-4 container-wht-blk rounded w-100">
                    <div class="d-none d-md-block"><p>Welcome to the Robotics Club of Central Florida.
                      <br> This is an entirely student run organization.
                    </p></div>
                    <div class="d-none d-sm-block">
                      <p>We focus on creating innovative and competitive robots and we are always
                        looking for members join in the advancement of the demanding robotics field.
                      </p>
                   </div>
                    <p>
                        Every year we take on projects that involve
                        demonstrations of robotics, pushing the bounds of automation, and innovative, robust designs.
                    </p>
                    <p>
                      Currently, we are realizing three challenging projects...
                    </p>
                  </div>
                </div>
              </div>
              <!-- /.content row -->
            </div>
            <!-- /.intro -->
          </div>
        </div>
        <!-- flex container -->
      </div>
      <!-- /.page container -->
    </div>
    <!-- /.who we are snap container -->

    <!-- robot slides snap container-->
    <div class="snap-child">
      <!-- Page Content Container 2 -->
      <div class="container">
        <!-- flex containers -->
        <div class="intermediate-container-flex">
          <h2 class="sr-only">Our Robots</h2>
          <?php
            $images = array("assets/imgs/placeholder-600x600.png", "assets/imgs/home/bowser.jpg", "assets/imgs/home/citrobot.jpg");
            $titles = array("Demobot", "Bowser", "Citrobot");
            $captions = array("Demonstrates all aspects of robotics.", "Uses computer vision to avoid objects.", "Our 15lb combat monster.");
            $slideshowGen->generateCircleSlideshow($images, $titles, $captions);
          ?>
        </div>
        <!-- /.flex containers -->
      </div>
      <!-- /.page content container -->
    </div>
    <!-- /.robot slides snapper -->


    <!-- grid snapper -->
    <div class="snap-child justify-content-center align-items-center" id="grid-snapper">
      <!-- flex containers -->
      <div class="end-container-flex justify-self-center align-self-center grid" id="grid-end-1">
        <?php
          include_once("assets/templates/grid.html");
        ?>
      </div>
      <!-- /.page container -->
    </div>
    <!-- /.grid -->


  </div>
  <!-- /.page snap container -->
</div>
<!-- page container -->
