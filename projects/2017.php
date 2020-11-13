<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "In 2017, the Robotics Club of Central Florida projects were an autonomous submarine, Ness, and an autonomous ground vehicle, Metaknight.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, projects, past projects, past projects 2017, 2017,
                               Ness, Metaknight";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club 2017 Projects", $pageDescription, $keywords, "https://robotics.ucf.edu/projects/2017");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/projects/2017", "Robotics Club 2017 Projects", $pageDescription, "https://robotics.ucf.edu/projects/assets/imgs/ness.jpg");
$headerGen->endHeader();


// navbar
include_once("../assets/templates/navbar.php");
$navbarGen = new Navbar(False);

?>

<!-- Page Content -->
<div class="container">

  <!-- our projects header -->
  <div class="header-container-sm">
    <h1 class="mt-4 mb-3 text-center rounded p-1 title-blk-gold">Our Projects
    </h1>

    <!-- Image Header -->
    <img class="img-fluid rounded mb-2" src="assets/imgs/header-2017.jpg" alt="bowser">

    <!-- text content -->
    <div class="row align-items-center justify-content-center text-center">
      <div class="col-lg-12">
        <div class="container-wht-blk rounded p-3">
          <p>The Robotics Club of Cental Florida is dedicated to producing new, innovative
             robots that challenge all aspects and majors of the club each year. Our Projects
             involve mechanical, electrical, and computer engineers as well as computer scientists
             to achieve overall project goals.
          </p>
          <p>For 2016-2017, our flagship robots were Metaknight, an autonomous ground vehicle that
            completed in IGVC and NESS, a submarine. Together, they offered a comprehensive
             chance to tackle mechanical, electrical, and software challenges!
          </p>
        </div>
      </div>
    </div>
  </div>
  <!-- /.our projects -->

  <h2 class="text-center p-1 title-blk-wht">2016-2017</h2>

  <!-- projects -->
  <div class="intermediate-container-xs">
    <?php
      include_once("assets/templates/project.php");
      $project = new Project();
      
      $description = "A autonomous submarine. Ness focused on modularity, ease of maintenance,
        neural network image recognition, and control systems. Ness offered unique
        software challenges for our computer scientists and and a
        modularity challenge for mechanical engineers.";
      $project->generate("Ness", "assets/imgs/ness.jpg", "ness", $description, "View Ness", "ness/index");
  
      $description = "An autonomous ground vehicle. Metakight involved heavy mechanical and computer science
        work to achieve object recognition and a fast enough pace. Both computer vision and a
        velodyne were used to map out the surroundings. Metaknight competed in IGVC 2017.";
      $project->generate("Metaknight", "assets/imgs/metaknight.jpg", "metaknight", $description, "View Metaknight", "metaknight/index");
    ?>
  </div>
  <!-- /.projects -->

  <?php
    require_once("../assets/templates/pagination-bottom.php");
    $pagination = new Pagination(2017, 2018, null);
    $pagination->generate(array("index", 2019, 2018, 2017), TRUE);
  ?>

  </div>
  <!-- /.container -->

<?php

// footer functions and include
include_once("../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
