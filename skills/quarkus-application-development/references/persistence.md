# Persistence: Hibernate ORM with Panache

Core JPA mapping, associations, N+1 and query design: use the `java-hibernate-jpa` skill. This file covers Quarkus specifics. Extensions: `quarkus-hibernate-orm-panache` + a JDBC driver such as `quarkus-jdbc-postgresql`.

## Config

```properties
# No URL/credentials in %dev/%test: PostgreSQL Dev Service starts automatically (Docker/Podman)
quarkus.hibernate-orm.schema-management.strategy=drop-and-create   # dev/test only
%prod.quarkus.datasource.jdbc.url=${DB_URL}
%prod.quarkus.datasource.username=${DB_USER}
%prod.quarkus.datasource.password=${DB_PASSWORD}
%prod.quarkus.hibernate-orm.schema-management.strategy=none        # use Flyway/Liquibase
```

`schema-management.strategy` verified on 3.40.1 and 3.27.6 (older docs use `quarkus.hibernate-orm.database.generation`; keep the project's form). Persistence units are configured in `application.properties`, not `persistence.xml`. Entities need no registration if they are in the application module.

## Active record vs repository (verified, PostgreSQL Dev Service)

```java
@Entity
public class Person extends PanacheEntity {            // active record: id is generated, public fields
    public String name;
    public static Person findByName(String n) { return find("name", n).firstResult(); }
}

@Entity
public class Book { @Id @GeneratedValue public Long id; public String title; }

@ApplicationScoped
public class BookRepository implements PanacheRepository<Book> {   // repository pattern
    public List<Book> byTitle(String t) { return list("title", t); }
}
```

Prefer the repository pattern for non-trivial domains (testable, mockable with `@InjectMock`, keeps entities plain POJOs); use active record only for simple CRUD. For a non-`Long` id use `PanacheRepositoryBase<E, ID>` / `PanacheEntityBase`. Panache offers `find`, `list`, `stream`, `count`, `delete`, `update`, `persist`, `page(Page.of(i, size))` for pagination, `Sort`, and `project(Dto.class)` for projections. Panache queries accept shortened HQL (`"name"`, `"name = ?1"`, `"from Person where name = :n"` with `Parameters`).

## Transactions

```java
@ApplicationScoped
public class BookService {
    @Inject BookRepository repo;
    @Transactional                                  // jakarta.transaction.Transactional
    public Book add(String title) { Book b = new Book(); b.title = title; repo.persist(b); return b; }
}
```

- Put `@Transactional` on service (or resource) methods that write; it applies through the CDI proxy, so self-calls do not start transactions.
- Programmatic: `QuarkusTransaction.requiringNew().call(() -> ...)` (`io.quarkus.narayana.jta`), used in the verified tests to read back committed data.
- Reads outside a transaction work (read-only session per call); lazy associations must be fetched inside the transaction or via fetch joins/projections.
- Tests: `@TestTransaction` rolls back (see `quarkus-dev-services-and-testing`).
- Do not use `open-in-view`-style patterns; map to DTO records before returning from a resource.

## Panache Next / Quarkus Data (status)

`quarkus-data-hibernate` ("Quarkus Data Hibernate", Panache Next, Jakarta Data support) is tagged `status:experimental` on code.quarkus.io for 3.40.1 (checked via `https://code.quarkus.io/api/extensions`). Do not use it for production code or recommend a migration unless the user asks; stay on `quarkus-hibernate-orm-panache`. Re-check the tag before advising.

## Reactive (Hibernate Reactive) tradeoff

`quarkus-hibernate-reactive-panache` with `Uni`-based APIs and Vert.x SQL clients (`quarkus-reactive-pg-client`) fits fully reactive stacks, but: separate extension set from ORM (do not mix both for the same datasource), more limited feature set, harder debugging, no `@Transactional` blocking style (use `@WithTransaction`/`@WithSession`), and Java 21+ virtual threads give most of the scalability benefit with the simpler blocking ORM. Default to blocking ORM + `@RunOnVirtualThread` where concurrency matters; pick Hibernate Reactive only when the whole call chain is non-blocking. Not verified in this skill's build.

## REST Data Panache

`quarkus-hibernate-orm-rest-data-panache` generates CRUD resources from repository interfaces; fine for prototypes, but explicit resources give control of validation, security and DTOs. Not verified here.
